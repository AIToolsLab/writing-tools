import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../db.js';
import {
	createRoom,
	getRoomForUser,
	listRooms,
	selectRoomForOAuth,
	selectedRoomForOAuth,
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

	it('binds an OAuth session only after checking room ownership', () => {
		const room = createRoom('owner', 'Draft', {
			beforeCursor: '',
			selectedText: 'draft',
			afterCursor: '',
		});
		expect(selectRoomForOAuth('session', 'other', room.id)).toBe(false);
		expect(selectedRoomForOAuth('session', 'other')).toBeUndefined();
		expect(selectRoomForOAuth('session', 'owner', room.id)).toBe(true);
		expect(selectedRoomForOAuth('session', 'owner')).toBe(room.id);
		expect(selectedRoomForOAuth('session', 'other')).toBeUndefined();
	});
});
