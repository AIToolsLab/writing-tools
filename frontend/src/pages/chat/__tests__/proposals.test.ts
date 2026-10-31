/**
 * The proposal loop end to end, through the real SDK with a scripted model:
 * the word-bank gate, a proposal waiting on the writer, Accept, and setting a
 * proposal aside by sending a new message.
 */
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { isStepCount, type ModelMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { noopEditorAPI } from '@/api/__fixtures__/editorAPI';
import { streamParts } from '@/api/generate';
import type { ChatDocState } from '@/contexts/chatContext';
import { editNote } from '@/docTools/editNote';
import { applySplice } from '@/docTools/ops';

import { chatTools } from '../chatTools';
import {
	answerProposal,
	displayTranscript,
	pendingProposals,
	setAsideReason,
	writerTurn,
} from '../transcript';

type StreamPart =
	Awaited<
		ReturnType<MockLanguageModelV4['doStream']>
	>['stream'] extends ReadableStream<infer Part>
		? Part
		: never;

const usage = {
	inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function toolCallStep(toolName: string, input: object): StreamPart[] {
	return [
		{ type: 'stream-start', warnings: [] },
		{
			type: 'tool-call',
			toolCallId: 'call-1',
			toolName,
			input: JSON.stringify(input),
		},
		{
			type: 'finish',
			finishReason: { unified: 'tool-calls', raw: undefined },
			usage,
		},
	];
}

function textStep(text: string): StreamPart[] {
	return [
		{ type: 'stream-start', warnings: [] },
		{ type: 'text-start', id: 't' },
		{ type: 'text-delta', id: 't', delta: text },
		{ type: 'text-end', id: 't' },
		{
			type: 'finish',
			finishReason: { unified: 'stop', raw: undefined },
			usage,
		},
	];
}

/** A model that plays `steps` in order, one per call. */
function scriptedModel(...steps: StreamPart[][]) {
	let call = 0;
	return new MockLanguageModelV4({
		doStream: () =>
			Promise.resolve({
				stream: convertArrayToReadableStream(steps[call++] ?? textStep('')),
			}),
	});
}

function setup(initial: string[]) {
	let paragraphs = [...initial];
	const editor = noopEditorAPI({
		getParagraphs: () => Promise.resolve([...paragraphs]),
		getDocText: () => Promise.resolve(paragraphs.join('\n')),
		applySplice: (splice) => {
			paragraphs = applySplice(paragraphs, splice);
			return Promise.resolve();
		},
	});
	const docState: ChatDocState = { baseline: [...initial], seen: new Set() };
	let messages: ModelMessage[] = [writerTurn('<document_context/>', 'Tighten this?')];
	const log = vi.fn(() => Promise.resolve());
	const onApplied = vi.fn();
	const tools = chatTools({
		editor,
		docState,
		briefText: () => [],
		messages: () => messages,
		onApplied,
		log,
	});
	const run = async (model: MockLanguageModelV4, history: ModelMessage[]) => {
		messages = history;
		const parts = streamParts({
			model,
			messages: history,
			tools: tools.tools,
			toolApproval: tools.toolApproval,
			// As Chat does: room to continue after an auto-denial.
			stopWhen: isStepCount(6),
		});
		let next = await parts.next();
		while (!next.done) next = await parts.next();
		return [...history, ...next.value];
	};
	return {
		tools,
		docState,
		log,
		onApplied,
		run,
		paragraphs: () => paragraphs,
		get messages() {
			return messages;
		},
	};
}

/** The prompt the model saw on its `n`th call, as JSON for loose matching. */
const promptOf = (model: MockLanguageModelV4, n: number) =>
	JSON.stringify(model.doStreamCalls[n].prompt);

describe('the word-bank gate', () => {
	it('denies an edit with words that are not the writer’s, without showing it', async () => {
		const t = setup(['The cat sat on the mat.']);
		const model = scriptedModel(
			toolCallStep('str_replace', {
				old_str: 'cat',
				new_str: 'elephant',
				paragraph: 1,
			}),
			textStep('Fair enough.'),
		);
		const messages = await t.run(model, t.messages);

		expect(t.paragraphs()).toEqual(['The cat sat on the mat.']);
		expect(promptOf(model, 1)).toMatch(/execution-denied.*elephant/);
		expect(displayTranscript(messages).map((m) => m.role)).toEqual([
			'user',
			'assistant',
		]);
		expect(t.log).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'edit_auto_denied',
				reason: 'word_bank',
				offending: 'elephant',
			}),
		);
	});

	it('denies an edit whose target is not in the document', async () => {
		const t = setup(['The cat sat.']);
		const model = scriptedModel(
			toolCallStep('str_replace', { old_str: 'dog', new_str: 'cat' }),
			textStep('Hm.'),
		);
		await t.run(model, t.messages);
		expect(promptOf(model, 1)).toMatch(/doesn't apply to the current document/);
	});
});

describe('a proposal the writer answers', () => {
	const proposeTrim = () =>
		toolCallStep('str_replace', {
			old_str: 'cat sat on the mat',
			new_str: 'cat sat',
			paragraph: 1,
		});

	it('waits for the writer when the words check out', async () => {
		const t = setup(['The cat sat on the mat.']);
		const model = scriptedModel(proposeTrim());
		const messages = await t.run(model, t.messages);

		expect(model.doStreamCalls).toHaveLength(1);
		expect(pendingProposals(messages)).toHaveLength(1);
		expect(t.paragraphs()).toEqual(['The cat sat on the mat.']);
	});

	it('applies on Accept, once, and keeps the model’s own edit out of the next note', async () => {
		const t = setup(['The cat sat on the mat.']);
		const proposed = await t.run(scriptedModel(proposeTrim()), t.messages);
		const [proposal] = pendingProposals(proposed);

		const result = await t.tools.applyProposal(
			proposal.toolCallId,
			proposal.toolName,
			proposal.input,
		);
		expect(result.ok).toBe(true);
		expect(t.paragraphs()).toEqual(['The cat sat.']);
		expect(t.onApplied).toHaveBeenCalledOnce();
		expect(editNote(t.docState.baseline!, t.paragraphs())).toBeNull();

		const model = scriptedModel(textStep('Done.'));
		const messages = await t.run(model, [
			...proposed,
			answerProposal(proposal, { approved: true, ...result }),
		]);
		// The SDK didn't run the tool a second time.
		expect(t.paragraphs()).toEqual(['The cat sat.']);
		expect(t.onApplied).toHaveBeenCalledOnce();
		expect(displayTranscript(messages)).toContainEqual(
			expect.objectContaining({ role: 'proposal', status: 'applied' }),
		);
	});

	it('keeps the history valid when the writer sets a proposal aside', async () => {
		const t = setup(['The cat sat on the mat.']);
		const proposed = await t.run(scriptedModel(proposeTrim()), t.messages);
		const [proposal] = pendingProposals(proposed);

		const model = scriptedModel(textStep('Sure, let’s talk about the ending.'));
		const messages = await t.run(model, [
			...proposed,
			answerProposal(proposal, {
				approved: false,
				reason: setAsideReason('What about the ending?'),
			}),
			writerTurn('<document_context/>', 'What about the ending?'),
		]);

		expect(t.paragraphs()).toEqual(['The cat sat on the mat.']);
		expect(promptOf(model, 0)).toMatch(/execution-denied.*set this proposal aside/);
		expect(displayTranscript(messages)).toContainEqual(
			expect.objectContaining({ role: 'proposal', status: 'set-aside' }),
		);
		expect(pendingProposals(messages)).toHaveLength(0);
	});
});
