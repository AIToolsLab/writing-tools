import { convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';
import { streamChat } from '@/lib/ai';
import { defaultModel } from '@/lib/models';
import { buildChatDocContextMessage } from '@/lib/prompts';
import type { DocContext } from '@/lib/types';

export async function POST(req: Request) {
	const { messages, docContext, system } = (await req.json()) as {
		messages: UIMessage[];
		docContext?: DocContext;
		system?: string;
	};

	// Prepend the current document context (sent fresh with each turn) ahead of the
	// conversation so the assistant can see what the writer is working on.
	const contextMessages: ModelMessage[] = docContext
		? [{ role: 'user', content: buildChatDocContextMessage(docContext) }]
		: [];

	const result = streamChat({
		model: defaultModel(),
		messages: [...contextMessages, ...convertToModelMessages(messages)],
		system,
	});

	return result.toUIMessageStreamResponse();
}
