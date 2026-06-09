import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	appendLog,
	pollLogs,
	validateUsername,
	zipLogs,
} from '../logging.js';

let dir: string;
const prevLogDir = process.env.LOG_DIR;

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'wt-logs-'));
	process.env.LOG_DIR = dir;
});

afterEach(() => {
	process.env.LOG_DIR = prevLogDir;
});

describe('validateUsername', () => {
	it('accepts alphanumerics, underscore, hyphen, and empty string', () => {
		expect(validateUsername('alice_01-x')).toBe('alice_01-x');
		expect(validateUsername('')).toBe('');
	});

	it('rejects path-traversal and separator characters', () => {
		expect(() => validateUsername('../etc')).toThrow();
		expect(() => validateUsername('a/b')).toThrow();
		expect(() => validateUsername('a.b')).toThrow();
	});

	it('rejects overly long names and non-strings', () => {
		expect(() => validateUsername('a'.repeat(51))).toThrow();
		expect(() => validateUsername(42 as unknown as string)).toThrow();
	});
});

describe('appendLog', () => {
	it('writes one JSON line per call to <username>.jsonl', async () => {
		await appendLog({
			timestamp: 1,
			ok: true,
			username: 'bob',
			event: 'click',
			extra_data: { a: 1 },
		});
		await appendLog({
			timestamp: 2,
			ok: true,
			username: 'bob',
			event: 'type',
			extra_data: {},
		});

		const content = await readFile(path.join(dir, 'bob.jsonl'), 'utf8');
		const lines = content.trim().split('\n');
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]!).event).toBe('click');
		expect(JSON.parse(lines[1]!).event).toBe('type');
	});

	it('refuses to write a traversing username', async () => {
		await expect(
			appendLog({
				timestamp: 1,
				ok: true,
				username: '../escape',
				event: 'x',
				extra_data: {},
			}),
		).rejects.toThrow();
	});
});

describe('pollLogs', () => {
	it('returns entries past the client position and dedupes by timestamp+username', async () => {
		await writeFile(
			path.join(dir, 'carol.jsonl'),
			[
				JSON.stringify({ timestamp: 1, username: 'carol', event: 'a' }),
				JSON.stringify({ timestamp: 1, username: 'carol', event: 'a' }), // dup
				JSON.stringify({ timestamp: 2, username: 'carol', event: 'b' }),
				'not json',
			].join('\n') + '\n',
		);

		const all = await pollLogs({});
		expect(all).toHaveLength(1);
		expect(all[0]!.username).toBe('carol');
		expect(all[0]!.logs).toHaveLength(2); // dup and bad line dropped

		const partial = await pollLogs({ carol: 1 });
		expect(partial[0]!.logs).toHaveLength(1);
	});

	it('returns [] when the log directory is missing', async () => {
		process.env.LOG_DIR = path.join(dir, 'does-not-exist');
		expect(await pollLogs({})).toEqual([]);
	});
});

describe('zipLogs', () => {
	it('archives every jsonl file', async () => {
		await appendLog({
			timestamp: 1,
			ok: true,
			username: 'dave',
			event: 'x',
			extra_data: {},
		});
		const zip = await zipLogs();
		const entries = unzipSync(zip);
		expect(Object.keys(entries)).toContain('dave.jsonl');
	});
});
