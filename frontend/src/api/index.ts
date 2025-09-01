export const SERVER_URL = '/api';

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
