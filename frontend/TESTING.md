# Build & Dev-Server Regression Tests

These tests lock the build output contract that the Vite migration must preserve.

## Asset structure

Two kinds of assets:

- **`src/assets/`** — imported in TypeScript/React code (e.g. carousel images).
  Processed by Vite and emitted with content hashes under `dist/assets/`.
  Import via the `@` alias, e.g. `import img from '@/assets/c1.png'`.
- **`public/assets/`** — referenced only by URL from static HTML. Copied as-is
  to `dist/assets/` and reached via absolute paths, e.g. `/assets/about.png`.

Static site files (`longDescription.html`, `privacypolicy.html`, `support.html`,
`seniorProject2024.html`, `styles.css`) and `manifest.xml` live in `public/` and
are copied to the `dist/` root.

## Test suites

### Build output (`test-build-output.mjs`)

Asserts, against an existing `dist/`:
- HTML entry points are at the `dist/` root (not `dist/src/`).
- No HTML leaks into `dist/src/`.
- JS + CSS bundles are emitted; images land in `dist/assets/`.
- Static site files are copied to the `dist/` root.
- `manifest.xml` is present and looks transformed.
- The Google Docs bundle is emitted as `dist/google-docs.bundle.js`.

Run:

```bash
npm run build && npm run build:google-docs
npm run test:build
```

### Dev server (`test-dev-server.mjs`)

Makes HTTP requests against a running dev server to confirm entry points,
static files, and `/assets/` are served, and that non-existent / old nested
`src/` paths return 404.

Run (in two terminals):

```bash
npm run dev-server      # terminal 1
npm run test:dev-server # terminal 2
```

## Google Docs bundle

`vite.google-docs.config.ts` builds `src/index-gdocs.tsx` into a single
self-contained IIFE, `dist/google-docs.bundle.js`, with assets inlined. It
writes into the shared `dist/` (`emptyOutDir: false`), so run the main build
first.

## Document and backend integration coverage

`npm test` includes `wordDocument.test.ts`, which exercises the Word adapter
against an offset-based Office.js test double. It covers selections and cursor
boundaries, paragraph-break normalization, sync failures, insertion/replacement,
and citation navigation. This does not replace testing inside real Word.

For the frontend-to-backend boundary, install both packages and run:

```bash
npm ci --prefix ../backend
npm ci
npm run test:integration
```

The integration suite runs the real prompt builder, AI SDK, Hono routes, response
stream forwarding, error conversion, and SQLite usage recording. Fetch dispatches
application requests to Hono in-process; only the external AI response is fake.
It rejects unexpected network destinations, uses a temporary database, and does
not load `.env` or spend API credits. It does not test real HTTP sockets, Vite's
proxy, OAuth sign-in, browser rendering, or Word/Google Docs installation.

The study app's `WritingArea` context, selection, editing, subject updates and
pending-send behavior are covered separately by `npm run test:run` in `experiment`.

## Browser through the real HTTP stack

From `frontend`, run:

```bash
npm ci
npm ci --prefix ../backend
npx playwright install chromium
npm run test:browser-integration
```

This separate Playwright suite starts Chromium, Vite with the application's API
proxy, the real Hono backend, and a local HTTP server that supplies fake AI
responses. Application API requests travel over HTTP without browser route
mocks. The harness redirects the backend's external AI requests to the local
provider and blocks other outbound destinations.

The two tests cover feedback appearing in the Draft UI, usage recording, revised
document context on a second request, and a visible quota error followed by a
successful retry that preserves the document.

The harness uses a fake API key, temporary SQLite data, and the existing local
authentication bypass. It skips the backend `.env` file and does not spend API
credits. It does not test OAuth, production HTTPS, or installation inside Word or
Google Docs.

Port 4317 must be free; backend and provider ports are assigned automatically.
The suite starts its own servers and cleans up temporary data on shutdown.
Failure traces are written to `test-results/integration/` and uploaded by the
separate browser integration CI job.
