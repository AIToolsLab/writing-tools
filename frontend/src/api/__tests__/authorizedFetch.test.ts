import { afterEach, expect, it, vi } from 'vitest';
import { authorizedFetch, setOpenAITokenProvider } from '../openai';

afterEach(() => setOpenAITokenProvider(() => Promise.resolve('')));

it.each(['empty', 'rejected'])(
	'removes the SDK placeholder when the session is %s',
	async (state) => {
		setOpenAITokenProvider(() => {
			if (state === 'rejected')
				return Promise.reject(new Error('login_required'));
			return Promise.resolve('');
		});
		const fetch = vi.fn<typeof globalThis.fetch>(() =>
			Promise.resolve(new Response('ok')),
		);
		vi.stubGlobal('fetch', fetch);
		await authorizedFetch('/api/openai/responses', {
			headers: {
				Authorization: 'Bearer unused',
				'Content-Type': 'application/json',
			},
		});
		const headers = new Headers(fetch.mock.calls[0][1]?.headers);
		expect(headers.has('Authorization')).toBe(false);
		expect(headers.get('Content-Type')).toBe('application/json');
		expect(headers.get('X-Client-Id')).toBeTruthy();
	},
);

it('attaches the current session token instead of the SDK placeholder', async () => {
	setOpenAITokenProvider(() => Promise.resolve('current-session'));
	const fetch = vi.fn<typeof globalThis.fetch>(() =>
		Promise.resolve(new Response('ok')),
	);
	vi.stubGlobal('fetch', fetch);
	await authorizedFetch('/api/openai/responses', {
		headers: { Authorization: 'Bearer unused' },
	});
	const headers = new Headers(fetch.mock.calls[0][1]?.headers);
	expect(headers.get('Authorization')).toBe('Bearer current-session');
});
