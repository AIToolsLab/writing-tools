import type { LogEntry } from '@/types/study';
import { appendFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const LOGS_DIR = resolve(process.cwd(), 'logs');

/**
 * Validate username format
 */
function isValidUsername(username: unknown): username is string {
  return typeof username === 'string' && /^[a-zA-Z0-9\-_]+$/.test(username);
}

/**
 * POST /api/log - Append a batch of log entries to per-participant JSONL files
 */
export async function POST(request: Request) {
  let entries: LogEntry[];
  try {
    const body = await request.json();
    if (!Array.isArray(body)) throw new Error('Expected an array of log entries');
    entries = body as LogEntry[];
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }

  // Group lines by participant. Skip (don't reject) invalid entries so one bad
  // entry can't make the client retry the whole batch forever.
  const linesByUsername = new Map<string, string[]>();
  for (const entry of entries) {
    if (!isValidUsername(entry?.username)) {
      console.warn('Skipping log entry with invalid username:', entry?.username);
      continue;
    }
    const lines = linesByUsername.get(entry.username) ?? [];
    lines.push(JSON.stringify(entry) + '\n');
    linesByUsername.set(entry.username, lines);
  }

  try {
    // Create logs directory if it doesn't exist and get its real path
    await mkdir(LOGS_DIR, { recursive: true });
    const realLogsDir = await realpath(LOGS_DIR);

    for (const [username, lines] of linesByUsername) {
      const logFilePath = resolve(realLogsDir, `${username}.jsonl`);
      // Verify the resolved path is within the logs directory (prevent directory traversal)
      if (!logFilePath.startsWith(`${realLogsDir}${sep}`)) {
        console.warn('Skipping log entries with invalid path:', username);
        continue;
      }
      await appendFile(logFilePath, lines.join(''), 'utf-8');
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Logging error:', error);

    return Response.json(
      { success: false, message: 'Internal error logging' },
      { status: 500 }
    );
  }
}
