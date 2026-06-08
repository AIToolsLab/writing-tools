import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

/**
 * Structured study log. Mirrors the `Log` shape written by the former FastAPI
 * backend so existing JSONL files and the Python analysis tooling in `scripts/`
 * keep working unchanged.
 */
export interface LogEntry {
	timestamp: number;
	ok: boolean;
	username: string;
	event: string;
	extra_data: Record<string, unknown>;
}

// Resolved lazily so tests can point LOG_DIR at a temp directory.
function logDir(): string {
	return path.resolve(process.env.LOG_DIR ?? './logs');
}

/**
 * Validate a study username before it is used as a `<username>.jsonl` filename.
 * Allows letters, digits, `_` and `-` only (empty string permitted) — this is
 * also the path-traversal guard, since it rejects `/`, `\` and `.`.
 * Ports `validate_username` from the old `server.py`.
 */
export function validateUsername(username: unknown): string {
	if (typeof username !== 'string') {
		throw new Error('Username must be a string.');
	}
	if (username.length > 50) {
		throw new Error('Username must be 50 characters or less.');
	}
	if (!/^[\p{L}\p{N}_-]*$/u.test(username)) {
		throw new Error("Username must be alphanumeric or contain '_' or '-' only.");
	}
	return username;
}

function logFilePath(username: string): string {
	return path.join(logDir(), `${validateUsername(username)}.jsonl`);
}

/** Append one JSON line to the user's log file. */
export async function appendLog(entry: LogEntry): Promise<void> {
	const dir = logDir();
	await mkdir(dir, { recursive: true });
	await appendFile(logFilePath(entry.username), `${JSON.stringify(entry)}\n`);
}

export interface LogUpdate {
	username: string;
	logs: unknown[];
}

/**
 * Read each `<username>.jsonl`, deduplicate by `timestamp|interaction|username`,
 * and return entries past the count the client already has. Ports `logs_poll`.
 */
export async function pollLogs(
	positions: Record<string, number>,
): Promise<LogUpdate[]> {
	const dir = logDir();
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		return [];
	}

	const updates: LogUpdate[] = [];
	let numFailed = 0;
	for (const file of files) {
		if (!file.endsWith('.jsonl')) continue;
		const username = file.slice(0, -'.jsonl'.length);
		if (username === '') continue; // skip a bare ".jsonl"

		const content = await readFile(path.join(dir, file), 'utf8');
		const seen = new Set<string>();
		const deduped: Record<string, unknown>[] = [];
		for (const line of content.split('\n')) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as Record<string, unknown>;
				const key = `${entry.timestamp}|${entry.username}`;
				if (!seen.has(key)) {
					seen.add(key);
					deduped.push(entry);
				}
			} catch {
				numFailed++;
			}
		}

		const start = positions[username] ?? 0;
		const newEntries = deduped.slice(start);
		if (newEntries.length > 0) {
			updates.push({ username, logs: newEntries });
		}
	}
	if (numFailed > 0) {
		console.warn(`Failed to parse ${numFailed} lines in log files.`);
	}
	return updates;
}

/** Zip every `*.jsonl` log file into an in-memory archive. Ports `download_logs`. */
export async function zipLogs(): Promise<Uint8Array> {
	const dir = logDir();
	let files: string[];
	try {
		files = await readdir(dir);
	} catch {
		files = [];
	}

	const archive: Record<string, Uint8Array> = {};
	for (const file of files) {
		if (!file.endsWith('.jsonl')) continue;
		archive[file] = new Uint8Array(await readFile(path.join(dir, file)));
	}
	return zipSync(archive);
}
