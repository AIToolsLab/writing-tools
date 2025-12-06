import { NextRequest, NextResponse } from 'next/server';
import { SuggestionRequestSchema } from '@/lib/types';
import { getSuggestion } from '@/lib/openai';
import { logEvent } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30; // 30 second timeout

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request with Zod
    const validationResult = SuggestionRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { username, gtype, doc_context } = validationResult.data;

    // Handle no_ai condition (study mode)
    if (gtype === 'no_ai') {
      return NextResponse.json({
        generation_type: 'no_ai',
        result: 'AI assistance is not available in this condition.',
        extra_data: {},
      });
    }

    // Get suggestion from OpenAI
    const result = await getSuggestion(gtype, doc_context);

    // Log the event asynchronously (don't await)
    logEvent(username, 'suggestion_generated', {
      generation_type: gtype,
      result: result.result,
      extra_data: result.extra_data,
      // Redact document text for non-study users
      doc_context: username
        ? doc_context
        : { ...doc_context, beforeCursor: '[REDACTED]', afterCursor: '[REDACTED]' },
    }).catch((err) => console.error('Failed to log event:', err));

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in /api/get_suggestion:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
