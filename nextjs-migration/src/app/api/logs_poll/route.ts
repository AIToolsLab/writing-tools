import { NextRequest, NextResponse } from 'next/server';
import { pollLogs } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Poll for new logs (protected by LOG_SECRET)
 * Used by researchers to monitor study data
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { secret, since } = body;

    // Verify secret
    const LOG_SECRET = process.env.LOG_SECRET;
    if (!LOG_SECRET || secret !== LOG_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get logs since timestamp
    const logs = await pollLogs(since);

    return NextResponse.json({ logs });
  } catch (error: any) {
    console.error('Error in /api/logs_poll:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
