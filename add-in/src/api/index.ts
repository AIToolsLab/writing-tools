export const SERVER_URL = '/api';

/**
 * Fetches response generations from the server's LLM for a given paragraph and prompt.
 *
 * @param {string} paragraph - The paragraph for which LLM responses are requested.
 * @param {string} prompt - The prompt used for the LLM response.
 * @returns {Promise<LLMResponseItem[]>} - A promise that resolves to an array of LLM response items.
 */
export async function getServerLLMResponse(
	username: string,
	paragraph: string,
	prompt: string
): Promise<LLMResponseItem[]> {
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

		const responseData: LLMResponses = await response.json();

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
