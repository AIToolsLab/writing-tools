// Disposable HTTP stack for Playwright. Never load developer credentials or call
// external services. Only OpenAI's response is replaced; /api uses the real app.
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

process.env.VITEST = '1'; // config.ts must not load backend/.env
process.env.OPENAI_API_KEY = 'browser-test-server-key';
process.env.OPENAI_DEMO_API_KEY = '';
process.env.BETTER_AUTH_ENABLED = 'false';
process.env.POSTHOG_PROJECT_TOKEN = '';
process.env.DISABLE_POSTHOG = '1';
process.env.VITE_LOCAL_AUTH_DISABLED = 'true';
const dataDir = await mkdtemp(path.join(tmpdir(), 'writing-browser-'));
process.env.DATA_DIR = dataDir;
process.env.LOG_DIR = path.join(dataDir, 'logs');

const backendRequire = createRequire(
	new URL('../../backend/package.json', import.meta.url),
);
const { serve } = await import(backendRequire.resolve('@hono/node-server'));
const { createApp } = await import('../../backend/src/app.ts');
const { closeDb, db } = await import('../../backend/src/db.ts');
let requests = [];
let mode = 'success';
let unexpectedRequests = [];
const fakeAI = createHttpServer(async (req, res) => {
	if (req.method !== 'POST' || req.url !== '/v1/responses') {
		res.writeHead(404).end();
		return;
	}
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const body = JSON.parse(Buffer.concat(chunks).toString());
	requests.push({ body, authorization: req.headers.authorization });
	if (mode === 'quota') {
		res.writeHead(429, { 'Content-Type': 'application/json' });
		res.end(
			JSON.stringify({
				error: {
					type: 'insufficient_quota',
					code: 'insufficient_quota',
					message: 'Test provider quota exhausted.',
				},
			}),
		);
		return;
	}
	const output = `- HTTP round trip ${requests.length}: consider who needs library access.`;
	const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
	res.writeHead(200, { 'Content-Type': 'text/event-stream' });
	res.write(
		event({
			type: 'response.created',
			response: { id: 'resp-http', created_at: 0, model: body.model },
		}),
	);
	res.write(
		event({
			type: 'response.output_item.added',
			output_index: 0,
			item: { type: 'message', id: 'msg-http' },
		}),
	);
	res.write(
		event({
			type: 'response.output_text.delta',
			item_id: 'msg-http',
			delta: output.slice(0, 20),
		}),
	);
	res.write(
		event({
			type: 'response.output_text.delta',
			item_id: 'msg-http',
			delta: output.slice(20),
		}),
	);
	res.write(
		event({
			type: 'response.completed',
			response: {
				model: body.model,
				usage: { input_tokens: 30, output_tokens: 12 },
			},
		}),
	);
	res.end('data: [DONE]\n\n');
});
await new Promise((resolve, reject) => {
	fakeAI.once('error', reject);
	fakeAI.listen(0, '127.0.0.1', resolve);
});
const providerOrigin = `http://127.0.0.1:${fakeAI.address().port}`;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : input);
	if (
		url.origin === 'https://api.openai.com' &&
		url.pathname === '/v1/responses'
	) {
		return nativeFetch(`${providerOrigin}/v1/responses`, init);
	}
	unexpectedRequests.push(url.toString());
	throw new Error(`External request blocked by test harness: ${url.origin}`);
};

const app = createApp();
// These routes exist only in this test process, never in the application.
app.post('/api/__test/reset', async (c) => {
	mode = (await c.req.json()).mode ?? 'success';
	requests = [];
	unexpectedRequests = [];
	db().prepare('DELETE FROM llm_usage').run();
	return c.json({ ok: true });
});
app.get('/api/__test/state', (c) =>
	c.json({
		requests,
		unexpectedRequests,
		usage: db()
			.prepare(
				'SELECT status, input_tokens, output_tokens FROM llm_usage ORDER BY id',
			)
			.all(),
	}),
);
const backend = await new Promise((resolve, reject) => {
	const server = serve(
		{ fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
		() => resolve(server),
	);
	server.once('error', reject);
});
const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
const vite = await createViteServer({
	configFile: path.resolve('vite.config.ts'),
	mode: 'test', // avoid Office certificate installation; localhost HTTP only
	define: { 'process.env.NODE_ENV': JSON.stringify('development') },
	server: {
		host: '127.0.0.1',
		port: 4317,
		strictPort: true,
		proxy: { '/api': { target: backendOrigin } },
	},
});
await vite.listen();
console.log('Browser integration stack ready on http://127.0.0.1:4317');
let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	await vite.close();
	await Promise.all(
		[backend, fakeAI].map(
			(server) =>
				new Promise((resolve) => {
					server.close(resolve);
					server.closeAllConnections();
				}),
		),
	);
	closeDb();
	await rm(dataDir, { recursive: true, force: true });
	process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
