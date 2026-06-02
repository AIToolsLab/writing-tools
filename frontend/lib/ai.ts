import { generateText, streamText, type LanguageModel, type ModelMessage } from 'ai';
import { buildMessages, buildRevisionPrompt, CHAT_SYSTEM_PROMPT, REVISE_SYSTEM_PROMPT } from './prompts';
import type { DocContext, GenerationResult } from './types';

const MAX_OUTPUT_TOKENS = 1024;

// Streaming chat. `messages` are already model-shaped (the route converts the UI
// messages from `useChat` via `convertToModelMessages`).
export function streamChat({
	model,
	messages,
	system = CHAT_SYSTEM_PROMPT,
}: {
	model: LanguageModel;
	messages: ModelMessage[];
	system?: string;
}) {
	return streamText({
		model,
		system,
		messages,
		maxOutputTokens: MAX_OUTPUT_TOKENS,
	});
}

// One-shot Draft suggestion. The UI awaits the full text, so this is non-streaming.
export async function generateSuggestion({
	model,
	type,
	docContext,
}: {
	model: LanguageModel;
	type: string;
	docContext: DocContext;
}): Promise<GenerationResult> {
	// buildMessages returns [system, user]; pass the system text via the `system`
	// option (rather than as a message) per the AI SDK's prompt-injection guidance.
	const [systemMessage, userMessage] = buildMessages(type, docContext);
	const { text } = await generateText({
		model,
		system: systemMessage.content,
		messages: [userMessage],
	});
	return { generation_type: type, result: text, extra_data: {} };
}

// Streaming Revise ("visualization") response.
export function streamRevision({
	model,
	docContext,
	request,
}: {
	model: LanguageModel;
	docContext: DocContext;
	request: string;
}) {
	return streamText({
		model,
		system: REVISE_SYSTEM_PROMPT,
		messages: [{ role: 'user', content: buildRevisionPrompt(docContext, request) }],
		maxOutputTokens: MAX_OUTPUT_TOKENS,
	});
}
