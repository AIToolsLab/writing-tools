// Event logging. Posts to /api/log, which is proxied to the Python backend (it owns the
// JSONL logs, the LOG_SECRET guard, and the two-tier privacy redaction). The rewrite is
// added in the logging commit; until then these POSTs simply 404 (fire-and-forget).
const SERVER_URL = '/api';

export interface LogPayload {
	username: string;
	event: string;
	// Logs should be able to hold anything serializable.
	[key: string]: unknown;
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
