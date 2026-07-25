import {
	createOpenAI,
	type OpenAIResponsesProviderOptions,
} from '@ai-sdk/openai';
import { DEVICE_CLIENT_ID } from './deviceAuth';
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
	// Identify this traffic as the first-party add-in so the proxy attributes its
	// usage to (user, add-in). External tools send their own client_id via a tool
	// grant token; the backend honours this header only for allowlisted ids.
	headers.set('X-Client-Id', DEVICE_CLIENT_ID);
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

export const OPENAI_MODEL = 'gpt-5.6-terra';

/**
 * The shared language model for all generation. `openai.responses()` selects the
 * Responses API (rather than `openai.chat()` / Chat Completions), which is what
 * the reasoning models expect.
 */
export const languageModel = openai.responses(OPENAI_MODEL);

/**
 * Passed as `providerOptions` on every `streamText` call. Low reasoning effort
 * keeps latency down for the interactive writing-help flows.
 */
export const openaiProviderOptions = {
	openai: { reasoningEffort: 'low' } satisfies OpenAIResponsesProviderOptions,
};
