import { NextRequest } from 'next/server';
import { ChatRequestSchema } from '@/lib/types';
import { chatStream } from '@/lib/openai';
import { logEvent } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 second timeout for streaming

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request
    const validationResult = ChatRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: validationResult.error.errors }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { username, messages } = validationResult.data;

    // Log the chat request asynchronously
    logEvent(username, 'chat_message', {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }).catch((err) => console.error('Failed to log event:', err));

    // Create SSE stream
    const stream = await chatStream(messages);

    // Create a readable stream for SSE
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          let fullResponse = '';

          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content || '';
            fullResponse += text;

            // Send SSE formatted data
            const sseData = `data: ${JSON.stringify({ text })}\n\n`;
            controller.enqueue(encoder.encode(sseData));
          }

          // Log the complete response
          logEvent(username, 'chat_response', {
            response: fullResponse,
          }).catch((err) => console.error('Failed to log response:', err));

          // Send done signal
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
