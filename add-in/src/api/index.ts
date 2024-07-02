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
    // timestamp: new Date().toISOString(),
    timestamp: new Date().getTime().toString(),
  };
  fetch(`${SERVER_URL}/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payloadWithTimestamp),
  });
}
