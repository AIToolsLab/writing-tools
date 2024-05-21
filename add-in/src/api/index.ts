export const SERVER_URL = '/api';

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
		const data = {
			username: username,
			paragraph,
			prompt
		};

		const key = JSON.stringify({ prompt, paragraph });

		const cachedResponse = localStorage.getItem(key);

		if (cachedResponse) return JSON.parse(cachedResponse);

		const response: Response = await fetch(`${SERVER_URL}/reflections`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(data)
		});

		if (!response.ok) throw new Error('Request failed ' + response.status);

		const responseData: ReflectionResponses = await response.json();

		localStorage.setItem(
			key,
			JSON.stringify(responseData.reflections)
		);

		return responseData.reflections;
	}
 catch (error) {
		return [];
	}
}
