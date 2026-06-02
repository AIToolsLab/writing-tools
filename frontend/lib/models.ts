import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

// The model used for all generations. Previously the browser sent requests to a Python
// proxy that injected the real key; now the key (OPENAI_API_KEY) lives server-side and
// is read lazily by the provider when a route handler runs.
export const OPENAI_MODEL = 'gpt-4o';

export function defaultModel(): LanguageModel {
	return openai(OPENAI_MODEL);
}
