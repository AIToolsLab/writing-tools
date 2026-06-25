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
