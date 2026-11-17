import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import {
	cursorWindow,
	displayTranscript,
	documentContext,
	writerTurn,
} from '../transcript';

describe('cursorWindow', () => {
	it('marks the cursor within its paragraph only', () => {
		expect(
			cursorWindow({
				beforeCursor: 'First paragraph.\nHello ',
				selectedText: '',
				afterCursor: 'world.\nThird paragraph.',
			}),
		).toBe('Hello <<CURSOR>>world.');
	});

	it('wraps the selection', () => {
		expect(
			cursorWindow({
				beforeCursor: 'Hello ',
				selectedText: 'big',
				afterCursor: ' world',
			}),
		).toBe('Hello <<SELECTION>>big<</SELECTION>> world');
	});

	it('clips a long paragraph on each side', () => {
		const window = cursorWindow(
			{
				beforeCursor: 'a'.repeat(50),
				selectedText: '',
				afterCursor: 'b'.repeat(50),
			},
			10,
		);
		expect(window).toBe(`…${'a'.repeat(10)}<<CURSOR>>${'b'.repeat(10)}…`);
	});
});

describe('documentContext', () => {
	const docContext: DocContext = {
		beforeCursor: 'One.\nTw',
		selectedText: '',
		afterCursor: 'o.',
	};

	it('carries the numbered document on the first turn only', () => {
		const first = documentContext({
			docContext,
			brief: null,
			paragraphs: ['One.', 'Two.'],
			baseline: null,
		});
		expect(first).toContain('[1] One.\n[2] Two.');
		expect(first).toContain('Tw<<CURSOR>>o.');

		const later = documentContext({
			docContext,
			brief: null,
			paragraphs: ['One.', 'Two.'],
			baseline: ['One.', 'Two.'],
		});
		expect(later).not.toContain('[1]');
		expect(later).not.toContain('Since you last saw');
		expect(later).toContain('Tw<<CURSOR>>o.');
	});

	it('notes what the writer changed since the baseline', () => {
		const context = documentContext({
			docContext,
			brief: null,
			paragraphs: ['One.', 'Two!'],
			baseline: ['One.', 'Two.'],
		});
		expect(context).toContain('[2] reworded: "Two!" (was "Two.")');
	});

	it('leads with the brief when there is one', () => {
		const context = documentContext({
			docContext,
			brief: 'Audience: reviewers',
			paragraphs: ['One.'],
			baseline: ['One.'],
		});
		expect(context).toMatch(/^<document_context>\nAudience: reviewers/);
	});

	it('omits the cursor window for an empty document', () => {
		const context = documentContext({
			docContext: { beforeCursor: '', selectedText: '', afterCursor: '' },
			brief: null,
			paragraphs: [''],
			baseline: null,
		});
		expect(context).not.toContain('<<CURSOR>>');
		expect(context).toContain('(the document is empty)');
	});
});

describe('displayTranscript', () => {
	it('shows what the writer typed, not the attached context', () => {
		expect(
			displayTranscript([writerTurn('<document_context>…', 'Hi')]),
		).toEqual([{ role: 'user', text: 'Hi' }]);
	});

	it('joins one reply across a tool call into one bubble', () => {
		const messages: ModelMessage[] = [
			writerTurn('<document_context>…', 'Is my intro clear?'),
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me look.' },
					{
						type: 'tool-call',
						toolCallId: 'c1',
						toolName: 'view',
						input: {},
					},
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'c1',
						toolName: 'view',
						output: { type: 'text', value: '[1] Intro.' },
					},
				],
			},
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'Mostly, yes.' }],
			},
		];
		expect(displayTranscript(messages)).toEqual([
			{ role: 'user', text: 'Is my intro clear?' },
			{ role: 'assistant', text: 'Let me look.\n\nMostly, yes.' },
		]);
	});

	it('skips an assistant step that only called a tool', () => {
		const messages: ModelMessage[] = [
			{
				role: 'assistant',
				content: [
					{
						type: 'tool-call',
						toolCallId: 'c1',
						toolName: 'view',
						input: {},
					},
				],
			},
		];
		expect(displayTranscript(messages)).toEqual([]);
	});

	it('never re-offers a proposal approved without a result', () => {
		// The app writes approval and result together; if only the approval
		// is there, the card must not show Accept again.
		const messages: ModelMessage[] = [
			{
				role: 'assistant',
				content: [
					{
						type: 'tool-call',
						toolCallId: 'c1',
						toolName: 'str_replace',
						input: { old_str: 'a', new_str: 'b' },
					},
					{
						type: 'tool-approval-request',
						approvalId: 'a1',
						toolCallId: 'c1',
					},
				],
			},
			{
				role: 'tool',
				content: [
					{
						type: 'tool-approval-response',
						approvalId: 'a1',
						approved: true,
					},
				],
			},
		];
		expect(displayTranscript(messages)).toEqual([
			expect.objectContaining({ role: 'proposal', status: 'failed' }),
		]);
	});
});
