import { NextRequest, NextResponse } from 'next/server';
import { LogEventSchema } from '@/lib/types';
import { logEvent } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request
    const validationResult = LogEventSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { username, event, ...extraData } = validationResult.data;

    // Log the event
    await logEvent(username, event, extraData);

    return NextResponse.json({ message: 'Feedback logged successfully.' });
  } catch (error: any) {
    console.error('Error in /api/log:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
