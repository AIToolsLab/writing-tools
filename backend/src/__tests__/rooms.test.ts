import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../db.js';
import {
	createRoom,
	consumeRoomSelection,
	deleteRoomsForUser,
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

	it('binds an OAuth request only after checking room ownership', () => {
		const room = createRoom('owner', 'Draft', {
			beforeCursor: '',
			selectedText: 'draft',
			afterCursor: '',
		});
		expect(selectRoomForOAuth('session', 'state-a', 'other', room.id)).toBe(false);
		expect(selectedRoomForOAuth('session', 'state-a', 'other')).toBeUndefined();
		expect(selectRoomForOAuth('session', 'state-a', 'owner', room.id)).toBe(true);
		expect(selectedRoomForOAuth('session', 'state-a', 'owner')).toBe(room.id);
		expect(selectedRoomForOAuth('session', 'state-a', 'other')).toBeUndefined();
	});

	it('isolates concurrent OAuth authorizations and consumes only the exchanged one', () => {
		const first = createRoom('owner', 'First', {
			beforeCursor: '', selectedText: 'first', afterCursor: '',
		});
		const second = createRoom('owner', 'Second', {
			beforeCursor: '', selectedText: 'second', afterCursor: '',
		});
		expect(selectRoomForOAuth('session', 'state-a', 'owner', first.id)).toBe(true);
		expect(selectRoomForOAuth('session', 'state-b', 'owner', second.id)).toBe(true);
		expect(selectedRoomForOAuth('session', 'state-a', 'owner')).toBe(first.id);
		expect(selectedRoomForOAuth('session', 'state-b', 'owner')).toBe(second.id);
		consumeRoomSelection('session', 'state-a');
		expect(selectedRoomForOAuth('session', 'state-a', 'owner')).toBeUndefined();
		expect(selectedRoomForOAuth('session', 'state-b', 'owner')).toBe(second.id);
	});

	it('deletes durable rooms and their pending OAuth selections for erasure', async () => {
		const room = createRoom('owner', 'Private draft', {
			beforeCursor: 'private', selectedText: '', afterCursor: '',
		});
		expect(selectRoomForOAuth('session', 'state', 'owner', room.id)).toBe(true);
		await deleteRoomsForUser('owner');
		expect(listRooms('owner')).toEqual([]);
		expect(selectedRoomForOAuth('session', 'state', 'owner')).toBeUndefined();
	});
});
