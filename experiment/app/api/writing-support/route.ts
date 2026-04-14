import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { ConversationMessage, WritingSupportRequest } from '@/types';

export const runtime = 'edge';

const MAX_CONVERSATION_CHARS = 4000;

const prompts = {
  example_sentences: `You are assisting a writer in drafting a document. Generate three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about **10 words**.`,

  example_withblanks: `You are assisting a writer in drafting a document. Generate three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about **10 words**.
- Where a specific fact or detail would go, use a bracketed placeholder (e.g., [name], [date], [specific detail]) instead of filling in the actual detail. This applies both to details mentioned in the conversation and to details that could reasonably be asked for later in the conversation. The writer must recall and insert these themselves.`,

  complete_document: `You are assisting a writer complete and polish their document. Please provide a completed and polished version of the document that the writer has started writing.

Guidelines:
- Use the text in the document as a starting point, but make any changes needed to make the document complete and polished.
- Maintain the writer's tone, style, and voice throughout.
- Polish the text for clarity and coherence.`,

  complete_document_withblanks: `You are assisting a writer complete and polish their document. Please provide a completed and polished version of the document that the writer has started writing.

Guidelines:
- Use the text in the document as a starting point, but make any changes needed to make the document complete and polished.
- Maintain the writer's tone, style, and voice throughout.
- Polish the text for clarity and coherence.
- Where a specific fact or detail would go, use a bracketed placeholder (e.g., [name], [date], [specific detail]) instead of filling in the actual detail. This applies both to details mentioned in the conversation and to details that could reasonably be asked for later in the conversation. The writer must recall and insert these themselves.`,

  proposal_advice: `You are assisting a writer in drafting a document by providing three directive (but not prescriptive) advice to help them develop their work. Your advice must be tailored to the document's genre. Use your best judgment to offer the most relevant and helpful advice, drawing from the following types of support as appropriate for the context:
- Support the writer in adhering to their stated writing goals or assignment guidelines.
- Help the writer think about what they could write next.
- Encourage the writer to maintain focus on their main idea and avoid introducing unrelated material.
- Recommend strengthening arguments by adding supporting evidence, specific examples, or clear reasoning.
- Advise on structuring material to achieve a clear and logical flow.
- Guide the writer in choosing language that is accessible and engaging for the intended audience.
- Guide the writer to think about what information is most important for the document, rather than providing the information directly.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- Keep each piece of advice under 20 words.
- Express the advice in the form of a directive instruction, not a question.
- Avoid providing specific words or phrases that the writer could directly copy into their document.
- Make each piece of advice very specific to the current document, not general advice that could apply to any document.
- The three pieces of advice should be diverse — each offering a distinct direction, perspective, or approach.`,

  analysis_readerPerspective: `You are assisting a writer in drafting a document for a specific person. Think carefully about the recipient's situation, needs, and concerns, then generate three possible reactions (questions, feelings, perspectives, etc.) the person might have upon receiving this message.

Guidelines:
- Imagine the reader receiving the final version of this message. What would they genuinely think, feel, or wonder about its content and implications?
- Limit each perspective to under 20 words.
- Ensure all perspectives specifically reflect details or qualities from the current document, avoiding broad or generic statements.
- The three perspectives should be diverse (in emotion, focus, tone, etc.)
- Each perspective should be expressed in 1st-person ("I like", "I wonder", "I feel", ...)
- Avoid telling the writer what to do; focus on the reader's viewpoint.
- Focus on the substance of what's been written so far, not on whether the document appears complete or polished.
- Avoid providing specific words or phrases that the writer could directly copy into their document.
- If there is insufficient context to generate genuine perspectives, return an empty list.`,
};

const listResponseSchema = z.object({
  responses: z.array(z.string()).describe('List of suggestions'),
});

// Bridging instruction for when conversation history is provided
const conversationBridge = 'The writer gathered information through a private 1-on-1 conversation with a colleague (shown below). This conversation is not visible to the document\'s reader.';

function formatConversationSection(
  messages: ConversationMessage[],
): string {
  // Truncate to fit within token budget
  let transcript = '';
  for (const msg of messages) {
    const label = msg.role === 'user' ? 'Writer' : 'Colleague';
    transcript += `${label}: ${msg.content}\n`;
  }
  if (transcript.length > MAX_CONVERSATION_CHARS) {
    transcript = transcript.slice(-MAX_CONVERSATION_CHARS);
    // Find the first complete line after truncation
    const firstNewline = transcript.indexOf('\n');
    if (firstNewline > 0) {
      transcript = transcript.slice(firstNewline + 1);
    }
  }

  return `\n\n# Conversation Between Writer and Colleague\n\n${conversationBridge}\n\n<conversation>\n${transcript.trim()}\n</conversation>\n\n`;
}

export async function POST(req: Request) {
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
  const conversationHistory = body.conversationHistory;

  try {
    const documentText = `${beforeCursor}${selectedText}${afterCursor}`;
    const beforeCursorTrim = beforeCursor.slice(-100);
    const afterCursorTrim = afterCursor.slice(0, 100);

    let fullPrompt = promptTemplate;

    // Insert conversation history between the system prompt and document
    if (conversationHistory && conversationHistory.length > 0) {
      fullPrompt += formatConversationSection(conversationHistory);
    }

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
