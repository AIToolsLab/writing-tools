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
	it('adds wt_grant to a URL with no fragment', () => {
		expect(withGrantFragment('https://tool.example/', 'g1')).toBe(
			'https://tool.example/#wt_grant=g1',
		);
	});

	it('appends to an existing fragment instead of clobbering it', () => {
		expect(withGrantFragment('https://tool.example/#/route', 'g1')).toBe(
			'https://tool.example/#/route&wt_grant=g1',
		);
	});

	it('url-encodes the grant id', () => {
		expect(withGrantFragment('https://tool.example/', 'a b')).toContain(
			'wt_grant=a%20b',
		);
	});
});

describe('createHandoff', () => {
	it('posts the request bearer-only and returns the grant', async () => {
		fetchMock.mockResolvedValue(
			resp({ grant_id: 'wtg_1', expires_in: 120 }),
		);

		const out = await createHandoff('tok', {
			toolClientId: 'mindmap',
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
			scopes: string[];
			doc: { beforeCursor: string };
		};
		expect(body.tool_client_id).toBe('mindmap');
		expect(body.scopes).toEqual(['openai:chat', 'doc:read']);
		expect(body.doc.beforeCursor).toBe('x');
	});

	it('throws the server detail on failure', async () => {
		fetchMock.mockResolvedValue(
			resp({ detail: 'Unknown tool_client_id.' }, false, 400),
		);
		await expect(
			createHandoff('tok', { toolClientId: 'nope' }),
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
