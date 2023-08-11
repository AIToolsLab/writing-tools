import { ReflectionResponseItem, ReflectionResponses } from '../interfaces';

export const SERVER_URL = '/api';

/**
 * Fetches reflections from the server for a given paragraph and prompt.
 *
 * @param {string} paragraph - The paragraph for which reflections are requested.
 * @param {string} prompt - The prompt used for reflection.
 * @returns {Promise<ReflectionResponseItem[]>} - A promise that resolves to an array of reflection response items.
 */
export async function getReflectionFromServer(
    paragraph: string,
    prompt: string
): Promise<ReflectionResponseItem[]> {
    try {
        const data = {
            user_id: -1, // TODO: Get user_id from somewhere
            paragraph,
            prompt,
        };

        const response: Response = await fetch(`${SERVER_URL}/reflections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error('Request failed ' + response.status);
        }

        const responseData: ReflectionResponses = await response.json();
        return responseData.reflections;
    } catch (error) {
        console.error(error);
        return [];
    }
}
