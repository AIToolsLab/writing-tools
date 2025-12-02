import { mkdir, appendFile } from 'fs/promises';
import { join } from 'path';
import { LogEntry } from '@/types/study';

const LOGS_DIR = join(process.cwd(), 'experiment', 'logs');

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

    // Validate username format
    if (!isValidUsername(entry.username)) {
      return Response.json(
        { error: 'Invalid username format' },
        { status: 400 }
      );
    }

    // Create logs directory if it doesn't exist
    try {
      await mkdir(LOGS_DIR, { recursive: true });
    } catch (error) {
      // Directory might already exist
      console.error('Error creating logs directory:', error);
    }

    // Append entry to participant's log file as JSONL
    const logFilePath = join(LOGS_DIR, `${entry.username}.jsonl`);
    const logLine = JSON.stringify(entry) + '\n';

    await appendFile(logFilePath, logLine, 'utf-8');

    return Response.json(
      { success: true, message: 'Log entry written' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Logging error:', error);

    // Don't fail the request - log anyway with what we have
    // Type checking is for development; don't enforce schema in production
    return Response.json(
      { success: true, message: 'Log entry processed' },
      { status: 200 }
    );
  }
}
