import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { closeDb } from '../db.js';
import { createRoom } from '../rooms.js';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), 'writing-tools-oauth-resource-'));
	process.env.DATA_DIR = dir;
});

afterEach(() => {
	closeDb();
	rmSync(dir, { recursive: true, force: true });
	delete process.env.DATA_DIR;
});

describe('GET /api/rooms/:roomId', () => {
	it('serves only the room named by the verified claim and owned by its subject', async () => {
		const room = createRoom('owner', 'Draft', {
			beforeCursor: 'private', selectedText: '', afterCursor: '',
		});
		const verifyOAuthAccessToken = vi.fn().mockResolvedValue({
			sub: 'owner',
			room_id: room.id,
		});
		const app = createApp({ verifyOAuthAccessToken });
		const response = await app.request(`/api/rooms/${room.id}`, {
			headers: { Authorization: 'Bearer header.payload.signature' },
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: room.id,
			doc: { beforeCursor: 'private' },
		});
		expect(verifyOAuthAccessToken).toHaveBeenCalledWith(
			'header.payload.signature',
			{
				verifyOptions: { audience: expect.any(String) },
				scopes: ['doc:read'],
			},
		);
	});

	it('rejects a valid token whose room claim does not match the path', async () => {
		const requested = createRoom('owner', 'Requested', {
			beforeCursor: '', selectedText: 'requested', afterCursor: '',
		});
		const other = createRoom('owner', 'Other', {
			beforeCursor: '', selectedText: 'other', afterCursor: '',
		});
		const app = createApp({
			verifyOAuthAccessToken: vi.fn().mockResolvedValue({
				sub: 'owner',
				room_id: other.id,
			}),
		});
		const response = await app.request(`/api/rooms/${requested.id}`, {
			headers: { Authorization: 'Bearer header.payload.signature' },
		});
		expect(response.status).toBe(403);
	});
});
