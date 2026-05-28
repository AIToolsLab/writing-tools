import { createOpenAI } from '@ai-sdk/openai';
import { SERVER_URL } from './index';

export const OPENAI_MODEL = 'gpt-4o';

export function createAuthenticatedOpenAI(token?: string) {
	return createOpenAI({
		baseURL: `${SERVER_URL}/openai`,
		apiKey: 'unused',
		fetch: async (input, init) => {
			const headers = new Headers(init?.headers);

			if (token) {
				headers.set('Authorization', `Bearer ${token}`);
			}

			return fetch(input, {
				...init,
				headers,
			});
		},
	});
}

export const openai = createAuthenticatedOpenAI();
