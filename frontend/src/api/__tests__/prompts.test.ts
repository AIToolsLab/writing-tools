import { describe, expect, it } from 'vitest';

import { buildMessages, DRAFT_INSTRUCTIONS } from '../prompts';

const docContext: DocContext = {
	beforeCursor: 'The opening paragraph. ',
	selectedText: '',
	afterCursor: 'The closing paragraph.',
};

describe('buildMessages', () => {
	// ai@7 throws InvalidPromptError ("System messages are not allowed in the
	// prompt or messages fields") when a system message reaches `messages`. The
	// draft system prompt is DRAFT_INSTRUCTIONS, passed as `instructions`.
	it('returns user messages only', () => {
		const messages = buildMessages('example_sentences', docContext);

		expect(messages.length).toBeGreaterThan(0);
		expect(messages.every((m) => m.role === 'user')).toBe(true);
		expect(DRAFT_INSTRUCTIONS).toContain('writing assistant');
	});

	it('includes the prompt, the brief, and the document', () => {
		const [message] = buildMessages(
			'proposal_advice',
			docContext,
			'Audience: my thesis committee',
		);

		expect(message.content).toContain('You are assisting a writer');
		expect(message.content).toContain('Audience: my thesis committee');
		expect(message.content).toContain('The opening paragraph.');
		expect(message.content).toContain('The closing paragraph.');
	});

	it('describes the selection when there is one', () => {
		const [message] = buildMessages('example_rewording', {
			beforeCursor: 'Before ',
			selectedText: 'the selected bit',
			afterCursor: ' after',
		});

		expect(message.content).toContain('## Current Selection');
		expect(message.content).toContain('the selected bit');
	});
});
