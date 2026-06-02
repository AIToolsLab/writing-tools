export const SERVER_URL = '/api';

// Re-export editor APIs
export { wordEditorAPI } from './wordEditorAPI';
export {
	googleDocsEditorAPI,
	isRunningInGoogleDocs,
	getGoogleUserEmail,
} from './googleDocsEditorAPI';

/**
 * Detects the current platform and returns the appropriate EditorAPI.
 */
export function detectPlatform(): 'word' | 'google-docs' | 'standalone' {
	if (
		typeof window !== 'undefined' &&
		window.RUNNING_IN_GOOGLE_DOCS === true
	) {
		return 'google-docs';
	}
	if (typeof Office !== 'undefined') {
		return 'word';
	}
	return 'standalone';
}

// Define a type for payload. Includes at least: eventType and username
export interface LogPayload {
	username: string;
	event: string;
	// biome-ignore lint/suspicious/noExplicitAny: Logs should be able to hold anything serializable
	[key: string]: any;
}

export function log(payload: LogPayload) {
	const payloadWithTimestamp = {
		...payload,
		timestamp: Date.now() / 1000,
	};
	return fetch(`${SERVER_URL}/log`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payloadWithTimestamp),
	});
}
