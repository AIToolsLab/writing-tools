import { NextRequest, NextResponse } from 'next/server';
import { ReflectionRequestSchema } from '@/lib/types';
import { reflection } from '@/lib/openai';
import { logEvent } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30; // 30 second timeout

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request
    const validationResult = ReflectionRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { username, paragraph, prompt } = validationResult.data;

    // Get reflection from OpenAI
    const result = await reflection(prompt, paragraph);

    // Log the event asynchronously
    logEvent(username, 'reflection_generated', {
      prompt,
      paragraph: username ? paragraph : '[REDACTED]',
      result: result.result,
      extra_data: result.extra_data,
    }).catch((err) => console.error('Failed to log event:', err));

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in /api/reflections:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
