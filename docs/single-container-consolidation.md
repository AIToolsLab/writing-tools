# Single-Container Consolidation Spec

**Goal:** collapse the two production containers (nginx serving `frontend/dist` +
reverse-proxying `/api/`, and the Hono backend) into **one container** where the Hono
server serves both the built frontend static files **and** the `/api/*` routes.

This is a deployment/topology change only. It does **not** change app behavior, the
API, the frontend source, or the local dev workflow. Write it on a branch layered on
`claude/backend-hono-migration-QE061` (the FastAPI→Hono migration), or after it merges.

This document is the complete brief. Follow it precisely — the cache-header rules in
particular are easy to get subtly wrong and will pin users to stale builds if botched.

---

## 1. Current state (before)

- `frontend` container: nginx (`frontend/Dockerfile`, `frontend/nginx.conf`) serves
  `frontend/dist` with tiered caching + SPA fallback, and proxies `location /api/` to
  `http://backend:5000`. Public web entry. Exposed ports: prod `19571:80`, staging
  `19573:80`, dev `5001:80`.
- `backend` container: Hono on Node (`backend/`), listens on `5000`. Not publicly
  exposed in prod/staging (only reachable via nginx).
- `experiment` container: separate Next.js app. **Leave it completely untouched.**
- Orchestration: `docker-compose.yml` (base) + `docker-compose-{dev,staging,prod}.yml`
  overrides, built/deployed by `Jenkinsfile`.

## 2. Target state (after)

- **One** web container = the Hono server, serving `frontend/dist` + `/api/*`. It is
  the public entry point and takes over the frontend's external ports.
- `frontend` service removed from compose. `frontend/Dockerfile` and
  `frontend/nginx.conf` deleted (frontend **source** stays — it's still built).
- `experiment` unchanged.

## 3. Frontend build facts you must rely on

From `frontend/webpack.config.js` (production: `npm run build` in `frontend/`):

- Output directory: **`frontend/dist`** (webpack default; the old FastAPI server
  served `../frontend/dist`).
- Hashed bundles: `[name].[contenthash].js` and `[name].[contenthash].css`
  (contenthash is ~20 lowercase hex chars). Images/fonts: `assets/[name].[contenthash][ext]`.
- HTML entry files emitted to `dist/` (fixed names, **not** content-hashed):
  `taskpane.html`, `editor.html`, `logs.html`, `popup.html`, `commands.html`.
- Copied verbatim into `dist/` via CopyWebpackPlugin: everything in `src/static/*`
  (**including `index.html`**, plus `privacypolicy.html`, `support.html`,
  `longDescription.html`, `seniorProject2024.html`), all of `assets/*`, and
  `manifest.xml` (with prod string transforms applied).
- `manifest.xml` (Office add-in manifest) is fetched by Office and must be served with
  `Content-Type: application/xml` (or `text/xml`) and **not** cached.

## 4. Cache-header rules to replicate (THE critical part)

These mirror `frontend/nginx.conf` exactly. The nginx regex for "immutable" assets is:
`\.[a-f0-9]{8,}\.(js|css|png|jpg|jpeg|gif|ico|woff|woff2|ttf)$`

| File class | Match | `Cache-Control` |
|---|---|---|
| Content-hashed assets | filename contains `.<8+ hex>.` then a static ext (js/css/png/jpg/jpeg/gif/ico/woff/woff2/ttf) | `public, max-age=31536000, immutable` |
| Other static assets (non-hashed js/css/img/fonts) | same exts but no hash segment | `public, max-age=3600, must-revalidate` |
| **All `*.html`** | `.html` | `no-store, must-revalidate` |
| `manifest.xml` | `manifest.xml` | `no-store, must-revalidate` |

> nginx today only `no-store`s `index.html` and leaves the other entry HTMLs on default
> heuristic caching. That is a latent bug — `taskpane.html` etc. reference hashed
> bundles and must never be stale. **In the consolidated server, `no-store` ALL
> `*.html`.** This is intentionally stricter than nginx and is correct.

## 5. Serving logic (Hono)

Order matters. Register in this exact order in `backend/src/app.ts` (or a new
`static.ts` mounted after the API routes):

1. **All existing `/api/*` routes first** (unchanged).
2. **Static file serving** for the built frontend, with the cache headers above.
3. **SPA fallback last**: for any GET that didn't match a file or an `/api` route,
   return `index.html` (this is nginx's `try_files $uri $uri/ /index.html`).

Use `serveStatic` from `@hono/node-server/serve-static` (already the runtime; no new
dep). Set its `root` to wherever `dist` is copied in the image (see §6 — recommend
`./public` relative to the container WORKDIR `/app/backend`). Set cache headers via the
`onFound` hook, and add a final fallback handler:

```ts
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';

const STATIC_ROOT = process.env.STATIC_ROOT ?? './public'; // dist copied here

const HASHED = /\.[a-f0-9]{8,}\.(js|css|png|jpg|jpeg|gif|ico|woff|woff2|ttf)$/;
const ASSET  = /\.(js|css|png|jpg|jpeg|gif|ico|woff|woff2|ttf)$/;

function setCacheHeaders(path: string, c: Context) {
  if (path.endsWith('.html') || path.endsWith('manifest.xml')) {
    c.header('Cache-Control', 'no-store, must-revalidate');
  } else if (HASHED.test(path)) {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (ASSET.test(path)) {
    c.header('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
}

// AFTER all app.post('/api/...') / app.get('/api/...') routes:
app.get(
  '*',
  serveStatic({ root: STATIC_ROOT, onFound: (path, c) => setCacheHeaders(path, c) }),
);

// SPA fallback: serve index.html for unmatched non-API GETs.
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/')) return c.notFound();
  const html = await readFile(`${STATIC_ROOT}/index.html`, 'utf8');
  c.header('Cache-Control', 'no-store, must-revalidate');
  return c.html(html);
});
```

Notes / gotchas:
- `serveStatic`'s `root` is resolved relative to `process.cwd()` (= `/app/backend` in
  the container). Confirm the path; a wrong root silently 404s every asset.
- Verify `serveStatic` sets correct `Content-Type` for `.js`/`.css`/`.html`/`.xml`. If
  `manifest.xml` comes back as `application/octet-stream`, set it explicitly in `onFound`.
- Keep the OpenAI SSE route untouched; serving static must not wrap or buffer it.
- Compression: nginx currently has **no `gzip on;`**, so there's nothing to match —
  do **not** add compression to reach parity. (Optional later: `hono/compress` or a
  webpack pre-compression plugin. Never compress the SSE response.)

## 6. Combined Dockerfile

The image must build the frontend (webpack) and the backend (tsc), then run Node with
`dist` available as static files. Because it needs both `frontend/` and `backend/`, the
build context must be the **repo root**. Create a root-level `Dockerfile`:

```dockerfile
# 1) Build frontend -> /frontend/dist
FROM node:24-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build           # outputs /frontend/dist

# 2) Build backend -> /app/backend/dist
FROM node:24-slim AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# 3) Runtime
FROM node:24-slim AS run
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=backend /app/backend/dist ./dist
COPY --from=frontend /frontend/dist ./public   # static root (STATIC_ROOT=./public)
RUN mkdir -p logs                               # study-log volume mount target
EXPOSE 5000
CMD ["node", "dist/index.js"]
```

- Keep WORKDIR `/app/backend` so the existing log volume mount `/app/backend/logs`
  stays valid (do not change the compose volume targets).
- If `frontend/webpack.config.js` needs HTTPS cert generation only for dev-server, the
  production `npm run build` path must not require it (it uses `env.WEBPACK_BUILD`).
  Confirm `npm run build` works headless in the image; if it tries to read dev certs,
  pass `--env WEBPACK_BUILD` or adjust.

## 7. docker-compose changes

In `docker-compose.yml` (base):
- **Delete the `frontend` service.**
- Point the `backend` service build at the new root Dockerfile:
  ```yaml
  backend:
    build:
      context: .
      dockerfile: Dockerfile
  ```
- Keep its env (`PORT=5000`, `OPENAI_API_KEY`, `LOG_SECRET`, `POSTHOG_*`).

In the override files, move the public port from the old frontend service onto
`backend`, and drop the frontend block:
- `docker-compose-prod.yml`: `backend.ports: ["19571:5000"]` (was frontend `19571:80`).
  Keep `volumes: /opt/thoughtful/logs:/app/backend/logs`.
- `docker-compose-staging.yml`: `backend.ports: ["19573:5000"]`. Keep
  `/opt/thoughtful/staging-logs:/app/backend/logs`.
- `docker-compose-dev.yml`: `backend.ports: ["5001:5000"]` (replaces frontend `5001:80`
  and the old `5000:5000`). Keep `./backend/logs:/app/backend/logs`.
- Remove `depends_on: backend` (the frontend service that had it is gone).
- Leave the `experiment` service and its ports/volumes exactly as-is.

## 8. Files to delete

- `frontend/Dockerfile`
- `frontend/nginx.conf`
(The `proxy_buffering off` SSE tweak in nginx.conf becomes irrelevant — there is no
nginx in the path anymore. Hono/Node does not buffer the streamed response.)

## 9. Jenkins

`Jenkinsfile` only runs `docker compose ... build` / `up`, so it keeps working with no
edits. Sanity-check: the combined image is bigger and the build now compiles the
frontend inside the backend image — confirm build time/host disk are acceptable. The
commented-out `Test`/`Lint` stages reference the old Python backend; ignore them.

## 10. Local dev is unchanged

Developers still run `frontend/`'s `npm run dev-server` (webpack dev-server on :3000
with its `/api` → backend proxy) and the backend's `npm run dev` (:8000). The
single-container static serving is a production/deploy concern only. Do not wire the
dev-server through the container.

## 11. Verification

Build and run the combined image locally (compose dev), then:

1. `curl -i http://localhost:5001/api/ping` → 200 `{ "timestamp": ... }`.
2. `curl -i http://localhost:5001/` → `index.html`, header
   `Cache-Control: no-store, must-revalidate`.
3. `curl -i http://localhost:5001/taskpane.html` → 200, `no-store`.
4. `curl -i` a hashed bundle (grab a real filename from `dist`, e.g.
   `/taskpane.<hash>.js`) → `Cache-Control: public, max-age=31536000, immutable`,
   correct `Content-Type: application/javascript`.
5. `curl -i http://localhost:5001/manifest.xml` → XML content-type, `no-store`.
6. `curl -i http://localhost:5001/some/spa/route` (no file) → returns `index.html`
   (200), **not** a 404; and `/api/does-not-exist` returns 404, **not** index.html.
7. Exercise Draft/Revise/Chat against this single origin and confirm SSE tokens stream
   live (no nginx now; the OpenAI proxy must still flush incrementally).
8. Load the add-in in Word against the deployed origin and confirm `manifest.xml`,
   `taskpane.html`, and assets all load.

## 12. Failure modes to watch

- **Stale builds:** any `*.html` served with caching → users keep old hashed bundles
  and the app breaks after a deploy. `no-store` all HTML.
- **Fallback shadowing the API:** if the `*` static/fallback is registered before the
  `/api` routes, API calls return `index.html`. API routes must come first; the
  fallback must exclude `/api/`.
- **Wrong static root:** `serveStatic({ root })` resolved against the wrong cwd → every
  asset 404s. Verify against `/app/backend/public`.
- **manifest MIME:** Office silently refuses a manifest served as the wrong type.
- **Build context too narrow:** the backend image can't see `frontend/` unless the
  build context is the repo root.
