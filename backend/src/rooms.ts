import { randomBytes } from 'node:crypto';
import { db } from './db.js';

export interface RoomDoc {
	documentLabel?: string;
	beforeCursor: string;
	selectedText: string;
	afterCursor: string;
	contextData?: unknown;
}

export interface Room {
	id: string;
	name: string;
	doc: RoomDoc;
	createdAt: number;
	updatedAt: number;
}

interface RoomRow {
	id: string;
	name: string;
	doc_snapshot: string;
	created_at: number;
	updated_at: number;
}

const ROOM_SELECTION_TTL_MS = 10 * 60 * 1000;

function parseRoom(row: RoomRow): Room {
	return {
		id: row.id,
		name: row.name,
		doc: JSON.parse(row.doc_snapshot) as RoomDoc,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function isRoomDoc(value: unknown): value is RoomDoc {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const doc = value as Record<string, unknown>;
	return (
		typeof doc.beforeCursor === 'string' &&
		typeof doc.selectedText === 'string' &&
		typeof doc.afterCursor === 'string' &&
		(doc.documentLabel === undefined || typeof doc.documentLabel === 'string')
	);
}

export function createRoom(userId: string, name: string, doc: RoomDoc): Room {
	const id = `room_${randomBytes(18).toString('base64url')}`;
	const now = Date.now();
	db()
		.prepare(
			`INSERT INTO room
			 (id, owner_user_id, name, doc_snapshot, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.run(id, userId, name, JSON.stringify(doc), now, now);
	return { id, name, doc, createdAt: now, updatedAt: now };
}

export function listRooms(userId: string): Room[] {
	const rows = db()
		.prepare(
			`SELECT id, name, doc_snapshot, created_at, updated_at
			 FROM room WHERE owner_user_id = ? ORDER BY updated_at DESC`,
		)
		.all(userId) as RoomRow[];
	return rows.map(parseRoom);
}

export function getRoomForUser(roomId: string, userId: string): Room | null {
	const row = db()
		.prepare(
			`SELECT id, name, doc_snapshot, created_at, updated_at
			 FROM room WHERE id = ? AND owner_user_id = ?`,
		)
		.get(roomId, userId) as RoomRow | undefined;
	return row ? parseRoom(row) : null;
}

export function selectRoomForOAuth(
	sessionId: string,
	userId: string,
	roomId: string,
): boolean {
	if (!getRoomForUser(roomId, userId)) return false;
	const now = Date.now();
	db()
		.prepare(`DELETE FROM oauth_room_selection WHERE expires_at <= ?`)
		.run(now);
	db()
		.prepare(
			`INSERT INTO oauth_room_selection (session_id, user_id, room_id, expires_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(session_id) DO UPDATE SET
			 user_id = excluded.user_id,
			 room_id = excluded.room_id,
			 expires_at = excluded.expires_at`,
		)
		.run(sessionId, userId, roomId, now + ROOM_SELECTION_TTL_MS);
	return true;
}

export function selectedRoomForOAuth(
	sessionId: string,
	userId: string,
): string | undefined {
	const row = db()
		.prepare(
			`SELECT room_id FROM oauth_room_selection
			 WHERE session_id = ? AND user_id = ? AND expires_at > ?`,
		)
		.get(sessionId, userId, Date.now()) as { room_id: string } | undefined;
	return row?.room_id;
}
