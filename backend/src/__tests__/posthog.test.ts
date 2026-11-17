import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression test for the outage where a failing PostHog ingestion host took the
 * whole backend down: posthogMiddleware used to `await posthog.flush()` after every
 * request, and flush() rejects on any non-2xx from the host. A transient 526 from
 * the analytics reverse proxy therefore turned every request — including the k8s
 * health probe — into a 500, and the deploy never went ready.
 *
 * Telemetry must stay strictly off the request's critical path: it may not decide a
 * response's status, and it may not add to its latency.
 *
 * The bad host here is a real local HTTP server rather than a mocked `fetch`:
 * posthog-node resolves the global fetch once when *it* is imported, which is
 * outside Vitest's module registry, so a `vi.stubGlobal('fetch', …)` in this file
 * may never be the one it calls.
 */

let server: Server;
let hostUrl: string;
/** Swapped per test to make the ingestion host fail in a particular way. */
let handle: (respond: (status: number) => void) => void;
/**
 * Bodies of the batches the fake PostHog received. Assertions match on the event
 * names inside them rather than counting requests: a client from an earlier test
 * can still have a chained flush in flight, so only the contents identify who sent
 * what.
 */
let batches: string[] = [];

beforeAll(async () => {
	server = createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => {
			body += chunk;
		});
		req.on('end', () => {
			batches.push(body);
			handle((status) => res.writeHead(status).end('error'));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	hostUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});

// posthog.ts builds its client from the environment at module load, so each test
// stubs the env, resets the module registry, and re-imports.
async function loadApp(route: string) {
	vi.stubEnv('POSTHOG_PROJECT_TOKEN', 'phc_test_token');
	vi.stubEnv('DISABLE_POSTHOG', '');
	vi.stubEnv('POSTHOG_HOST', hostUrl);
	vi.resetModules();

	const { posthogMiddleware } = await import('../posthog.js');
	const { Hono } = await import('hono');
	const app = new Hono();
	app.use('*', posthogMiddleware);
	app.get(route, (c) => c.json({ ok: true }));
	return app;
}

// posthog-node batches: it only sends once flushAt (20) events are queued, so a run
// of requests is what provokes an ingestion attempt at all.
const OVER_FLUSH_AT = 25;

beforeEach(() => {
	batches = [];
	handle = (respond) => respond(526); // what the reverse proxy was returning
});

describe('posthogMiddleware with a failing PostHog host', () => {
	it('serves requests normally while ingestion 526s', async () => {
		const app = await loadApp('/api/thing');

		for (let i = 0; i < OVER_FLUSH_AT; i++) {
			const res = await app.request('/api/thing');
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ ok: true });
		}

		// The failing ingestion really was attempted — otherwise this test would
		// pass just as well with telemetry silently doing nothing.
		await vi.waitFor(() =>
			expect(batches.some((b) => b.includes('GET /api/thing'))).toBe(true),
		);
	});

	it('does not make requests wait on a hung ingestion host', async () => {
		handle = () => {
			/* accept the connection, never respond */
		};
		const app = await loadApp('/api/thing');

		const started = Date.now();
		for (let i = 0; i < OVER_FLUSH_AT; i++) {
			expect((await app.request('/api/thing')).status).toBe(200);
		}
		// The client's own requestTimeout is 3s; the old await-flush middleware
		// would have blocked for at least that long before failing the request.
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it('does not capture health-probe requests', async () => {
		const app = await loadApp('/api/ping');

		for (let i = 0; i < OVER_FLUSH_AT; i++) {
			expect((await app.request('/api/ping')).status).toBe(200);
		}
		// Well past flushAt with nothing queued, so no probe ever reaches PostHog.
		await new Promise((r) => setTimeout(r, 100));
		expect(batches.filter((b) => b.includes('/api/ping'))).toEqual([]);
	});
});

describe('captureException with a failing PostHog host', () => {
	it('resolves promptly instead of throwing or hanging', async () => {
		handle = () => {
			/* accept the connection, never respond */
		};
		vi.stubEnv('POSTHOG_PROJECT_TOKEN', 'phc_test_token');
		vi.stubEnv('POSTHOG_HOST', hostUrl);
		vi.resetModules();
		const { captureException } = await import('../posthog.js');

		const started = Date.now();
		await captureException(new Error('boom'));
		expect(Date.now() - started).toBeLessThan(1000);
	});
});
