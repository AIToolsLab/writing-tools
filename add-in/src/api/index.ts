export const SERVER_URL = '/api';

// Define a type for payload. Includes at least: eventType and username
export interface LogPayload {
	username: string;
	interaction: string;
	[key: string]: any;
}

export function log(payload: LogPayload) {
	const payloadWithTimestamp = {
		...payload,
		timestamp: +new Date() / 1000
	};
	fetch(`${SERVER_URL}/log`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payloadWithTimestamp)
	});
}

/**
 * Fetches reflections from the server for a given paragraph and prompt.
 *
 * @param {string} paragraph - The paragraph for which reflections are requested.
 * @param {string} prompt - The prompt used for reflection.
 * @returns {Promise<ReflectionResponseItem[]>} - A promise that resolves to an array of reflection response items.
 */
export async function getReflection(
	username: string,
	paragraph: string,
	prompt: string
): Promise<ReflectionResponseItem[]> {
	try {
		const key = JSON.stringify({ prompt, paragraph });

		const cachedResponse = localStorage.getItem(key);

		if (cachedResponse) return JSON.parse(cachedResponse);

		const data = {
			username: username,
			paragraph,
			prompt
		};

		const response: Response = await fetch(`${SERVER_URL}/reflections`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(data)
		});

		if (!response.ok) throw new Error('Request failed ' + response.status);

		const responseData: ReflectionResponses = await response.json();

		localStorage.setItem(key, JSON.stringify(responseData.reflections));

		return responseData.reflections;
	} catch (error) {
		return [];
	}
}
