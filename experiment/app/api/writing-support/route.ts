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

// Bridging instructions for when conversation history is provided
const directBridging: Record<string, string> = {
  example_sentences: 'The writer gathered information through the conversation below. Use relevant details from this conversation to generate contextually accurate sentence options.',
  complete_document: 'The writer gathered information through the conversation below. Use relevant details to complete the document accurately.',
  proposal_advice: 'The writer gathered information through the conversation below. Consider this context when giving advice.',
  analysis_readerPerspective: 'The writer gathered information through the conversation below. Consider what the reader would think given the facts discussed.',
};

const nudgeBridging: Record<string, string> = {
  example_sentences: 'The writer gathered information through the conversation below. Generate sentences with bracketed placeholders (e.g., [room], [time], [name]) where specific facts from the conversation would go. Do NOT fill in the actual details — the writer must recall and insert them.',
  complete_document: 'The writer gathered information through the conversation below. Complete the document structure but use bracketed placeholders (e.g., [room], [time], [specific detail]) for facts from the conversation. The writer must fill these in themselves.',
  proposal_advice: 'The writer gathered information through the conversation below. Reference topics from the conversation without revealing specific details. Guide the writer to think about what information matters, without being prescriptive about exact facts.',
  analysis_readerPerspective: 'The writer gathered information through the conversation below. React to whether the document addresses the reader\'s likely concerns, but do not reveal specific facts from the conversation in your reactions.',
};

function formatConversationSection(
  messages: ConversationMessage[],
  mode: string,
  historyMode: 'direct' | 'nudge',
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

  const bridging = historyMode === 'nudge'
    ? (nudgeBridging[mode] || '')
    : (directBridging[mode] || '');

  return `\n\n# Conversation Between Writer and Colleague\n\n${bridging}\n\n<conversation>\n${transcript.trim()}\n</conversation>\n\n`;
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
  const conversationHistoryMode = body.conversationHistoryMode || 'direct';

  try {
    const documentText = `${beforeCursor}${selectedText}${afterCursor}`;
    const beforeCursorTrim = beforeCursor.slice(-100);
    const afterCursorTrim = afterCursor.slice(0, 100);

    let fullPrompt = promptTemplate;

    // Insert conversation history between the system prompt and document
    if (conversationHistory && conversationHistory.length > 0) {
      fullPrompt += formatConversationSection(conversationHistory, context, conversationHistoryMode);
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
