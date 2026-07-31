import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../db.js';
import {
	createRoom,
	deleteRoomsForUser,
	getRoomForUser,
	listRooms,
} from '../rooms.js';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'writing-tools-rooms-'));
	process.env.DATA_DIR = dir;
});

afterEach(() => {
	closeDb();
	rmSync(dir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

describe('rooms', () => {
	it('keeps document snapshots private to their owner', () => {
		const room = createRoom('owner', 'Draft', {
			beforeCursor: 'hello',
			selectedText: ' ',
			afterCursor: 'world',
		});
		expect(listRooms('owner')).toHaveLength(1);
		expect(getRoomForUser(room.id, 'owner')?.doc.afterCursor).toBe('world');
		expect(getRoomForUser(room.id, 'other')).toBeNull();
	});

	it('deletes durable rooms for erasure', async () => {
		const room = createRoom('owner', 'Private draft', {
			beforeCursor: 'private', selectedText: '', afterCursor: '',
		});
		await deleteRoomsForUser('owner');
		expect(listRooms('owner')).toEqual([]);
		expect(getRoomForUser(room.id, 'owner')).toBeNull();
	});
});
