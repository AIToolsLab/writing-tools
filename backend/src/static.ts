import { existsSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono } from 'hono';

// The built frontend (`frontend/dist`) is copied here in the production image
// (see the repo-root Dockerfile). `serveStatic` resolves this relative to the
// process cwd, which is /app/backend in the container. In local dev this
// directory doesn't exist and frontend serving is skipped entirely.
const STATIC_ROOT = process.env.STATIC_ROOT ?? './public';

// Vite emits content-hashed bundles and assets as `name-<hash>.<ext>` (the hash
// is 8 base64url chars: A-Za-z0-9_-), all under assets/. Those filenames change
// every build, so they're safe to cache forever. Note this is NOT webpack's
// `.<hex>.` convention the old nginx.conf matched — that regex never matched a
// single Vite asset, silently downgrading them to the short cache below.
const HASHED =
	/-[A-Za-z0-9_-]{8,}\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp)$/;
const ASSET = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp)$/;

function setCacheHeaders(path: string, c: Context): void {
	if (path.endsWith('.html') || path.endsWith('manifest.xml')) {
		// CRITICAL correctness rule: HTML entry points reference hashed bundles
		// by name, so a cached HTML pins clients to old bundles after a deploy.
		// manifest.xml is fetched by Office and must stay fresh too. With hashed
		// filenames this no-store is the *only* cache rule that affects
		// correctness; the immutable/short rules below are pure optimization.
		c.header('Cache-Control', 'no-store, must-revalidate');
		// Office silently refuses a manifest served as the wrong type.
		if (path.endsWith('manifest.xml')) c.header('Content-Type', 'application/xml');
	} else if (HASHED.test(path)) {
		c.header('Cache-Control', 'public, max-age=31536000, immutable');
	} else if (ASSET.test(path)) {
		c.header('Cache-Control', 'public, max-age=3600, must-revalidate');
	}
}

// Register static serving for the built frontend. Call this AFTER every /api/*
// route is registered so the API always wins; unmatched non-API GETs fall
// through to a 404 (the frontend is a multi-page app — there is no SPA
// index.html fallback). `serveStatic` serves index.html for `/`.
export function serveFrontend(app: Hono): void {
	if (!existsSync(STATIC_ROOT)) return;
	app.get('*', serveStatic({ root: STATIC_ROOT, onFound: setCacheHeaders }));
}
