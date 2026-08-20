import { SERVER_URL } from './index';

export async function createRoom(
	token: string,
	doc: DocContext,
): Promise<{ id: string; name: string }> {
	const res = await fetch(`${SERVER_URL}/rooms`, {
		method: 'POST',
		credentials: 'omit',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			name: doc.documentLabel,
			doc,
		}),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { detail?: string };
		throw new Error(body.detail ?? `Room creation failed (${res.status})`);
	}
	return (await res.json()) as { id: string; name: string };
}

export function withRoomHint(url: string, roomId: string): string {
	const target = new URL(url);
	target.searchParams.set('room', roomId);
	return target.toString();
}
