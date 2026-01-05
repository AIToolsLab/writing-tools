import type { LogEntry } from '@/types/study';
import { appendFile, mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOGS_DIR = resolve(process.cwd(), 'experiment', 'logs');

/**
 * Validate username format
 */
function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9\-_]+$/.test(username) && username.length > 0;
}

/**
 * POST /api/log - Log an event to a JSONL file
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const entry = body as LogEntry;
    const username = entry.username;

    // Validate username format
    if (!isValidUsername(username)) {
      return Response.json(
        { error: 'Invalid username format' },
        { status: 400 }
      );
    }

    // Create logs directory if it doesn't exist and get its real path
    await mkdir(LOGS_DIR, { recursive: true });
    const realLogsDir = await realpath(LOGS_DIR);

    // Construct log file path using validated username
    const logFilePath = resolve(realLogsDir, `${username}.jsonl`);

    // Verify the resolved path is within the logs directory (prevent directory traversal)
    if (!logFilePath.startsWith(`${realLogsDir}/`)) {
      return Response.json(
        { error: 'Invalid log file path' },
        { status: 400 }
      );
    }

    // Append entry to participant's log file as JSONL
    const logLine = JSON.stringify(entry) + '\n';

    await appendFile(logFilePath, logLine, 'utf-8');

    return Response.json(
      { success: true, message: 'Log entry written' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Logging error:', error);

    return Response.json(
      { success: false, message: 'Internal error logging' },
      { status: 500 }
    );
  }
}
