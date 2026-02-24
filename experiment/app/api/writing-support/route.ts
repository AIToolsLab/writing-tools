import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import type { WritingSupportRequest } from '@/types';

// export const runtime = 'edge'; // Edge runtime is currently disabled since Better Auth
// rate limiting needs persistent server process for in-memory storage

const prompts = {
  example_sentences: `You are assisting a writer in drafting a document. Generate three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about **10 words**.`,

  complete_document: `You are assisting a writer complete and polish their document. Please provide a completed and polished version of the document that the writer has started writing.

Guidelines:
- Use the text in the document as a starting point, but make any changes needed to make the document complete and polished.
- Maintain the writer's tone, style, and voice throughout.
- Polish the text for clarity and coherence.`,

  proposal_advice: `You are assisting a writer in drafting a document by providing three directive (but not prescriptive) advice to help them develop their work. Your advice must be tailored to the document's genre. Use your best judgment to offer the most relevant and helpful advice, drawing from the following types of support as appropriate for the context:
- Support the writer in adhering to their stated writing goals or assignment guidelines.
- Help the writer think about what they could write next.
- Encourage the writer to maintain focus on their main idea and avoid introducing unrelated material.
- Recommend strengthening arguments by adding supporting evidence, specific examples, or clear reasoning.
- Advise on structuring material to achieve a clear and logical flow.
- Guide the writer in choosing language that is accessible and engaging for the intended audience.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- Keep each piece of advice under 20 words.
- Express the advice in the form of a directive instruction, not a question.
- Avoid providing specific words or phrases that the writer could directly copy into their document.
- Make each piece of advice very specific to the current document, not general advice that could apply to any document.`,

  analysis_readerPerspective: `You are assisting a writer in drafting a document for a specific person. Generate three possible reactions (questions, feelings, perspectives, etc.) the person might have about the document.

Guidelines:
- Limit each perspective to under 20 words.
- Ensure all perspectives specifically reflect details or qualities from the current document, avoiding broad or generic statements.
- The three perspectives should be diverse (in emotion, focus, tone, etc.)
- Each perspective should be expressed in 1st-person ("I like", "I wonder", "I feel", ...)
- Avoid telling the writer what to do; focus on the reader's viewpoint.
- The writer may not be finished writing the document; if the last sentence is incomplete, ignore that and focus on the content that is already written.
- Avoid providing specific words or phrases that the writer could directly copy into their document.
- If there is insufficient context to generate genuine perspectives, return an empty list.`,
};

const listResponseSchema = z.object({
  responses: z.array(z.string()).describe('List of suggestions'),
});

export async function POST(req: Request) {
  // Rate limiting via Better Auth: build a bodyless probe so auth.handler()
  // can check the IP against the customRule for this path without consuming
  // the original request body. Returns 429 (with X-Retry-After) if exceeded.
  const probe = new Request(req.url, { method: req.method, headers: req.headers });
  const rateLimitResponse = await auth.handler(probe);
  if (rateLimitResponse.status === 429) return rateLimitResponse;

  const body: WritingSupportRequest = await req.json();

  // Validate the request body
  if (!body.editorState) {
    return NextResponse.json(
      { error: 'Missing editorState in request body' },
      { status: 400 }
    );
  }

  const { beforeCursor, selectedText, afterCursor } = body.editorState;
  const context = (body.context as keyof typeof prompts) || 'proposal_advice';
  const promptTemplate = prompts[context];

  try {
    const documentText = `${beforeCursor}${selectedText}${afterCursor}`;
    const beforeCursorTrim = beforeCursor.slice(-100);
    const afterCursorTrim = afterCursor.slice(0, 100);

    let fullPrompt = promptTemplate;
    fullPrompt += `\n\n# Writer's Document So Far\n\n<document>\n${documentText}</document>\n\n`;

    if (selectedText === '') {
      fullPrompt += `## Text Right Before the Cursor\n\n"${beforeCursorTrim}"`;
    } else {
      fullPrompt += `## Current Selection\n\n${selectedText}`;
      fullPrompt += `\n\n## Text Nearby The Selection\n\n"${beforeCursorTrim}${selectedText}${afterCursorTrim}"`;
    }

    const result = await generateObject({
      model: openai('gpt-5.2'),
      schema: listResponseSchema,
      prompt: fullPrompt,
      system: 'You are a helpful and insightful writing assistant.',
    });

    const suggestions = result.object.responses.length > 0
      ? [result.object.responses.map(item => `- ${item}`).join('\n\n')]
      : ['Insufficient content to generate suggestions.'];

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('Error generating suggestion:', error);
    return NextResponse.json(
      { error: 'Failed to generate suggestion' },
      { status: 500 }
    );
  }
}
