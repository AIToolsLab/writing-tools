# Single-Container Consolidation

**Status:** implemented (branch `single-container-consolidation`). This document
describes the design as built and the one-time deploy migration it requires.

**Goal:** collapse the two production containers (nginx serving `frontend/dist` +
reverse-proxying `/api/`, and the Hono backend) into **one container** where the Hono
server serves both the built frontend static files **and** the `/api/*` routes.

This is a deployment/topology change. App behaviour, the API, and the local dev
workflow are unchanged. The cache-header rules are easy to get subtly wrong, so §4
explains exactly which rule actually matters.

---

## 1. Before

- `frontend` container: nginx (`frontend/Dockerfile`, `frontend/nginx.conf`) served
  `frontend/dist` and proxied `location /api/` to `http://backend:5000`. Public web
  entry. Ports: prod `19571:80`, staging `19573:80`, dev `5001:80`.
- `backend` container: Hono on Node, listens on `5000`. Not publicly exposed in
  prod/staging (only reachable via nginx).
- `experiment` container: separate Next.js app. **Left completely untouched.**
- Two persistent volumes on the backend: study **logs** and the auth **SQLite DB**.
- Orchestration: `docker-compose.yml` + `docker-compose-{dev,staging,prod}.yml`,
  built/deployed by `Jenkinsfile`; new GitHub Actions build runs in parallel (§9).

## 2. After

- **One** web container = the Hono server, serving `frontend/dist` + `/api/*`. It is
  the public entry point and takes over the frontend's external ports.
- `frontend` service removed from compose. `frontend/Dockerfile` and
  `frontend/nginx.conf` deleted (frontend **source** stays — it's still built).
- **One** persistent volume per environment (§7).
- `experiment` unchanged.

## 3. Frontend build facts (Vite — `npm run build` in `frontend/`)

The frontend migrated from webpack to **Vite** (`frontend/vite.config.ts`). The build
that the image relies on:

- Output directory: **`frontend/dist`** (`build.outDir`).
- **Content-hashed bundles land under `dist/assets/`** as `name-<hash>.<ext>`, where
  `<hash>` is **8 base64url chars** (`A-Za-z0-9_-`), e.g. `index-CFpNvIDr.js`,
  `editor-C-cTUUZm.css`, `c1-BBI24REH.png`. This is **not** webpack's `name.<hex>.ext`
  convention — see the cache-rule warning in §4.
- HTML entry files emitted to `dist/` (fixed names, **not** hashed): `index.html`,
  `taskpane.html`, `editor.html`, `logs.html`, `popup.html`, `commands.html`. The app
  is a **multi-page app** (`appType: 'mpa'`) — there is **no** SPA index.html fallback.
- `publicDir: 'public'` is copied verbatim into `dist/`: `manifest.xml`, the public
  site HTML (`privacypolicy.html`, `support.html`, `longDescription.html`,
  `seniorProject2024.html`), `styles.css`, and all of `public/assets/*` (non-hashed
  images like `logo.png`, `calvin-logo.webp`, `slides.svg`).
- `manifest.xml` is fetched by Office and must be served as `application/xml` (or
  `text/xml`) and **not** cached. A `closeBundle` plugin in `vite.config.ts` rewrites
  it for production (strips `-dev`, swaps the dev id/URL for the prod ones).
- **Google Docs bundle:** `npm run build:google-docs`
  (`vite.google-docs.config.ts`) emits a single self-contained IIFE,
  `dist/google-docs.bundle.js`, that the Apps Script sidebar loads by absolute URL.
  The image serves it at **`/gdocs/google-docs.bundle.js`** (the sidebar's `PROD_BASE`)
  as well as the dist root.

> **Bug fixed during this work:** the google-docs lib build (run after `vite build`
> into the same `dist/` with `emptyOutDir: false`) defaulted to `publicDir: 'public'`
> and therefore re-copied the **raw** `public/manifest.xml` over the prod-transformed
> one — shipping a `localhost:3000` / `-dev` manifest. The old nginx image had this
> bug too. `vite.google-docs.config.ts` now sets `publicDir: false`. Verified: the
> built image serves the prod manifest (`app.thoughtful-ai.com`, prod id `…2508`).

## 4. Cache-header rules (the one that matters)

With content-hashed filenames, the **only correctness-critical rule is: never cache
HTML or `manifest.xml`.** If an HTML entry point is cached, clients keep referencing
old hashed bundles after a deploy and the app breaks. The immutable/short rules below
are pure performance — getting them slightly wrong cannot pin anyone to a stale build
(the filename changes every build).

Implemented in `backend/src/static.ts` via `serveStatic`'s `onFound` hook:

| File class | Match | `Cache-Control` |
|---|---|---|
| **`*.html` and `manifest.xml`** | ends with `.html` / `manifest.xml` | `no-store, must-revalidate` (**critical**) |
| Content-hashed assets | `-<8+ base64url chars>.<ext>` (js/css/png/jpg/jpeg/gif/svg/ico/woff/woff2/ttf/webp) | `public, max-age=31536000, immutable` |
| Other static assets | same exts, no hash segment | `public, max-age=3600, must-revalidate` |

```ts
const HASHED = /-[A-Za-z0-9_-]{8,}\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp)$/;
const ASSET  = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp)$/;
```

> The deleted `nginx.conf` matched hashes with `\.[a-f0-9]{8,}\.` — webpack's hex
> convention. That regex matched **zero** Vite assets, so every hashed bundle silently
> got the 1-hour rule instead of `immutable`. The new rule uses Vite's `-<hash>.`
> shape. (No `public/assets/*` filename matches it, so there are no false positives.)
>
> Compression: nginx had no `gzip on;`, so nothing to match — none added. Never
> compress the SSE response if compression is added later.

## 5. Serving logic (Hono)

`backend/src/static.ts` exports `serveFrontend(app)`. `backend/src/index.ts` calls it
**after every `/api/*` route is registered — including the dynamically-added
`/api/device` and `/api/debug/*` routes**, so the API always wins. Registration order:

1. All `/api/*` routes (unchanged), incl. the dynamic device/debug ones in `index.ts`.
2. `serveFrontend(app)` → `app.get('*', serveStatic({ root: STATIC_ROOT, onFound }))`.

Notes / gotchas (all verified against the running image):
- `STATIC_ROOT` defaults to `./public`, resolved against the container WORKDIR
  `/app/backend`. `serveFrontend` is a **no-op when that directory is absent** (local
  dev), so the backend stays quiet there.
- `serveStatic` serves `index.html` for `/`, sets correct `Content-Type` (incl.
  `application/xml` for the manifest, also forced in `onFound`), and on a miss falls
  through to a **404** — correct for an MPA (no SPA fallback). `/api/does-not-exist`
  → 404, not index.html.
- The OpenAI SSE route returns the upstream `Response` body directly; static serving
  (GET `*`, registered after) never wraps the POST proxy. Tokens stream live (no nginx
  buffering in the path anymore).

## 6. Combined Dockerfile (repo root)

`Dockerfile` at the **repo root** (build context must be the root — the image needs
both `frontend/` and `backend/`). Three stages:

1. `frontend` — `npm ci` + `npm run build && npm run build:google-docs` → `/frontend/dist`.
2. `backend` — `npm install` + `npm run build` (tsc) → `/app/backend/dist`.
3. `run` — `node:24-slim`, `npm install --omit=dev`, then copies:
   - `--from=backend dist → ./dist`
   - `--from=frontend /frontend/dist → ./public` (the static root)
   - `--from=frontend …/google-docs.bundle.js → ./public/gdocs/google-docs.bundle.js`

WORKDIR stays `/app/backend`. A root **`.dockerignore`** keeps the context small
(excludes `node_modules`, `.venv`, `experiment/`, `own-words/`, `backend/data`,
`backend/logs`, etc.). `EXPOSE 5000`; `CMD ["node", "dist/index.js"]`. The runtime
`PORT` defaults to **8000** in code, so compose **must** set `PORT=5000`.

## 7. Persistent storage — single volume

Both pieces of persistent state now live under **one** mounted directory,
`/app/backend/data`:
- `auth.db` — already at `/app/backend/data/auth.db` (fixed path in `auth.ts`).
- study logs — moved here via `LOG_DIR=/app/backend/data/logs` (set in compose base).
  `logging.ts` already `mkdir -p`s the dir on first write and tolerates its absence on
  read, so a fresh empty volume just works (verified).

Compose volume mounts (each environment, single line):
- dev: `./backend/data:/app/backend/data`
- staging: `/opt/thoughtful/staging-data:/app/backend/data`
- prod: `/opt/thoughtful/data:/app/backend/data`

**One-time host migration (staging/prod), before first deploy of this change:**

```sh
# prod (staging: swap the paths for staging-data / staging-logs / staging-auth)
mkdir -p /opt/thoughtful/data/logs
mv /opt/thoughtful/auth/auth.db /opt/thoughtful/data/
mv /opt/thoughtful/logs/*       /opt/thoughtful/data/logs/
```

## 8. docker-compose changes

- **`docker-compose.yml`**: deleted the `frontend` service; pointed `backend.build` at
  the root `Dockerfile` (`context: .`); added `LOG_DIR=/app/backend/data/logs`. Kept
  all existing env (OpenAI/PostHog/Better-Auth). `experiment` untouched.
- Overrides — move the old frontend public port onto `backend`, single data volume:
  - dev: `backend.ports: ["5001:5000"]`, volume `./backend/data:/app/backend/data`.
  - staging: `backend.ports: ["19573:5000"]`, volume `…/staging-data:/app/backend/data`.
  - prod: `backend.ports: ["19571:5000"]`, volume `…/data:/app/backend/data`.
- `depends_on: backend` removed with the frontend service.

## 9. CI/CD

- **GitHub Actions (new):** `.github/workflows/build-addin-image.yml` builds the
  combined image from the root `Dockerfile` and pushes to
  `ghcr.io/aitoolslab/writing-tools-addin`, SHA-tagged + `latest`, on push to `main`
  (paths: `frontend/**`, `backend/**`, `Dockerfile`, `.dockerignore`, the workflow).
  Mirrors `build-experiment-image.yml`; CD (Infrastructure_k8s_* repo) pins the SHA.
- **Jenkins (kept for now):** `Jenkinsfile` still runs `docker compose … build`/`up`
  and keeps working with the consolidated compose — it builds the combined image and
  brings up one fewer service. Runs **in parallel** with GHA during the deployment
  migration; remove it once CD fully moves to the GHCR image.
- Other workflows unchanged: `add-in.yml` (lint), `frontend-tests.yml` (Vitest +
  Playwright), `build-experiment-image.yml`.

## 10. Deleted files

- `frontend/Dockerfile`, `frontend/nginx.conf` (no nginx in the path; Hono/Node does
  not buffer the SSE response).
- `backend/Dockerfile` — orphaned by the consolidation. The root `Dockerfile`'s
  `backend` stage replicates it, and compose's `backend.build` now points at the root
  Dockerfile, so nothing referenced it anymore.

## 11. Local dev is unchanged

Developers still run `frontend/` `npm run dev-server` (Vite dev-server on :3000 with
its `/api` → backend proxy) and the backend's `npm run dev` (:8000). The single
container is a production/deploy concern only; do not wire the dev-server through it.

## 12. Verification (run against the built image)

Build & run locally (note `PORT=5000`):

```sh
docker build -t writing-tools-addin:test -f Dockerfile .
docker run --rm -p 5099:5000 -e PORT=5000 -e LOG_DIR=/app/backend/data/logs writing-tools-addin:test
```

Checked (all passing):
1. `GET /api/ping` → 200 `{ "timestamp": … }`.
2. `GET /` → `index.html`, `Cache-Control: no-store, must-revalidate`.
3. `GET /taskpane.html` → 200, `no-store`.
4. `GET /assets/<name>-<hash>.js` → `public, max-age=31536000, immutable`, JS type.
5. `GET /manifest.xml` → `application/xml`, `no-store`, **prod-transformed**
   (`app.thoughtful-ai.com`, id `…2508`, no `-dev`).
6. `GET /some/unknown/route` → **404** (MPA); `GET /api/does-not-exist` → 404.
7. `GET /gdocs/google-docs.bundle.js` → 200.
8. `POST /api/log` writes to `/app/backend/data/logs/<user>.jsonl` (single volume).
9. Backend `npm test` (13 passing) and frontend `npm run test:build` green.

Still to validate in a real deploy: SSE streaming end-to-end with a live
`OPENAI_API_KEY`, and loading the add-in in Word against the deployed origin.

## 13. Failure modes to watch

- **Stale builds:** any `*.html` served with caching → users keep old hashed bundles.
  `no-store` all HTML + manifest. (The only correctness-critical rule.)
- **`PORT` unset:** the server defaults to 8000; compose must set `PORT=5000` or the
  published port maps to nothing.
- **Fallback shadowing the API:** static `*` must register **after** all `/api/*`
  routes, including the dynamic device/debug ones in `index.ts`.
- **Manifest clobbered by the google-docs build:** keep `publicDir: false` in
  `vite.google-docs.config.ts` (see §3).
- **Forgotten host migration:** without §7's `mv`, the new single volume starts empty
  — auth sessions and prior logs appear to vanish.
- **manifest MIME:** Office silently refuses a manifest served as the wrong type.
