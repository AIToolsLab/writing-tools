import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the helper off the real ./index (which pulls in the Office/Google editor
// APIs); only SERVER_URL is needed.
vi.mock('../index', () => ({ SERVER_URL: '/api' }));

import { createHandoff, openInBrowser, withGrantFragment } from '../handoff';

type Json = Record<string, unknown>;
const resp = (data: Json, ok = true, status = 200) =>
	({ ok, status, json: () => Promise.resolve(data) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('withGrantFragment', () => {
	const API = 'https://app.example/api';

	it('adds the grant and the platform API base to a URL with no fragment', () => {
		expect(withGrantFragment('https://tool.example/', 'g1', API)).toBe(
			'https://tool.example/#wt_grant=g1&wt_api=https%3A%2F%2Fapp.example%2Fapi',
		);
	});

	it('appends to an existing fragment instead of clobbering it', () => {
		expect(withGrantFragment('https://tool.example/#/route', 'g1', API)).toBe(
			'https://tool.example/#/route&wt_grant=g1&wt_api=https%3A%2F%2Fapp.example%2Fapi',
		);
	});

	it('url-encodes the grant id', () => {
		expect(withGrantFragment('https://tool.example/', 'a b', API)).toContain(
			'wt_grant=a%20b',
		);
	});

	// The tool talks to whichever backend granted it, so one hosted bundle can serve
	// several deployments — the base has to survive the round trip intact.
	it('round-trips the API base through the fragment', () => {
		const url = new URL(withGrantFragment('https://tool.example/', 'g1', API));
		const params = new URLSearchParams(url.hash.slice(1));
		expect(params.get('wt_api')).toBe(API);
	});
});

describe('createHandoff', () => {
	it('posts the request bearer-only and returns the grant', async () => {
		fetchMock.mockResolvedValue(
			resp({ grant_id: 'wtg_1', expires_in: 120 }),
		);

		const out = await createHandoff('tok', {
			toolClientId: 'mindmap',
			toolUrl: 'https://tool.example/app',
			scopes: ['openai:chat', 'doc:read'],
			doc: { beforeCursor: 'x', selectedText: '', afterCursor: '' },
		});

		expect(out).toEqual({ grantId: 'wtg_1', expiresIn: 120 });
		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			{
				credentials: string;
				headers: Record<string, string>;
				body: string;
			},
		];
		expect(url).toBe('/api/handoff');
		expect(init.credentials).toBe('omit');
		expect(init.headers.Authorization).toBe('Bearer tok');
		const body = JSON.parse(init.body) as {
			tool_client_id: string;
			tool_url: string;
			scopes: string[];
			doc: { beforeCursor: string };
		};
		expect(body.tool_client_id).toBe('mindmap');
		// The backend binds the grant to this URL's origin, so the launch URL has to
		// travel with the request.
		expect(body.tool_url).toBe('https://tool.example/app');
		expect(body.scopes).toEqual(['openai:chat', 'doc:read']);
		expect(body.doc.beforeCursor).toBe('x');
	});

	it('throws the server detail on failure', async () => {
		fetchMock.mockResolvedValue(
			resp({ detail: 'Unknown tool_client_id.' }, false, 400),
		);
		await expect(
			createHandoff('tok', {
				toolClientId: 'nope',
				toolUrl: 'https://tool.example/',
			}),
		).rejects.toThrow('Unknown tool_client_id.');
	});
});

describe('openInBrowser', () => {
	it('prefers the Office system-browser bridge in the task pane', () => {
		const openBrowserWindow = vi.fn();
		vi.stubGlobal('Office', { context: { ui: { openBrowserWindow } } });
		const windowOpen = vi.fn();
		vi.stubGlobal('window', { open: windowOpen });

		openInBrowser('https://tool.example/#wt_grant=g1');

		expect(openBrowserWindow).toHaveBeenCalledWith(
			'https://tool.example/#wt_grant=g1',
		);
		expect(windowOpen).not.toHaveBeenCalled();
	});

	it('falls back to window.open when Office is absent', () => {
		vi.stubGlobal('Office', undefined);
		const windowOpen = vi.fn();
		vi.stubGlobal('window', { open: windowOpen });

		openInBrowser('https://tool.example/');

		expect(windowOpen).toHaveBeenCalledWith(
			'https://tool.example/',
			'_blank',
			'noopener,noreferrer',
		);
	});
});
