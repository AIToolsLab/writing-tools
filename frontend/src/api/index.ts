export const SERVER_URL = '/api';

// Define a type for payload. Includes at least: eventType and username
export interface LogPayload {
	username: string;
	interaction: string;
	[key: string]: any;
}

export async function pingServer(): Promise<void> {
  try {
		// Ping the server, which returns the server's current timestamp
		const url = `${SERVER_URL}/ping`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
			// eslint-disable-next-line no-console
      console.warn('Server ping failed:', response.status);
    }

		const data = await response.json();
		// eslint-disable-next-line no-console
		console.log('Server ping successful:', data);
  }
	catch (error) {
		// eslint-disable-next-line no-console
    console.warn('Server ping error:', error);
    // Don't throw - we want to silently handle ping failures
  }
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
	prompt: string,
	accessToken: string | null
): Promise<ReflectionResponseItem[]> {
	try {
		const key = JSON.stringify({ prompt, paragraph });

		const cachedResponse = localStorage.getItem(key);
		// ASSUMES that cachedResponse is valid JSON

		if (cachedResponse) return JSON.parse(cachedResponse);

		const data = {
			username: username,
			paragraph,
			prompt
		};

		const response: Response = await fetch(`${SERVER_URL}/reflections`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken || 'none'}`
			},
			body: JSON.stringify(data)
		});

		if (!response.ok) throw new Error('Request failed ' + response.status);

		const responseData: GenerationResult = await response.json();
		// console.log('responseData', responseData);

		// HACK: fake a list of ReflectionResponseItem objects
		const relfectionResponses = [
			{
				reflection: responseData.result
			}
		];

		localStorage.setItem(key, JSON.stringify(relfectionResponses));

		return relfectionResponses;
	}
	catch (error) {
		// TODO: Log errors better
		// TODO: Handle auth errors (e.g., token expired)
		// eslint-disable-next-line no-console
		console.error(error);
		return [];
	}
}
