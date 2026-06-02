import { convertToModelMessages, type UIMessage } from 'ai';
import { streamChat } from '@/lib/ai';
import { defaultModel } from '@/lib/models';

export async function POST(req: Request) {
	const { messages, system } = (await req.json()) as {
		messages: UIMessage[];
		system?: string;
	};

	const result = streamChat({
		model: defaultModel(),
		messages: convertToModelMessages(messages),
		system,
	});

	return result.toUIMessageStreamResponse();
}
