import { createOpenAI } from '@ai-sdk/openai';
import { SERVER_URL } from './index';

/**
 * The backend proxy authenticates every model request and meters its token usage
 * against the signed-in user, so the client has to send the session token.
 *
 * This client is a module singleton reached from non-React code (the Fetcher class
 * in the draft page), so it can't read the token from a hook. Instead the auth
 * layer installs a token getter here at startup — AppAuthTokenBridge calls
 * setOpenAITokenProvider — and the custom `fetch` below attaches a fresh token to
 * each request. Before the provider is installed (or when signed out) requests go
 * out unauthenticated and the proxy answers 401, which surfaces as a normal
 * generation error.
 */
let tokenProvider: (() => Promise<string>) | null = null;

export function setOpenAITokenProvider(provider: () => Promise<string>): void {
	tokenProvider = provider;
}

async function authorizedFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const headers = new Headers(init?.headers);
	try {
		const token = await tokenProvider?.();
		// Overwrites the placeholder `apiKey` Bearer header the SDK sets.
		if (token) headers.set('Authorization', `Bearer ${token}`);
	} catch {
		// Not signed in — send it unauthenticated and let the proxy reject it.
	}
	return fetch(input, { ...init, headers });
}

export const openai = createOpenAI({
	baseURL: `${SERVER_URL}/openai`,
	// The real credential is the session token attached by authorizedFetch; the
	// SDK only requires this to be non-empty.
	apiKey: 'unused',
	fetch: authorizedFetch,
});

export const OPENAI_MODEL = 'gpt-4o';
