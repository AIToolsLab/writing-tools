import { describe, expect, it } from 'vitest';

import { docContextMessageContent, withCurrentDocContext } from '../index';

describe('chat document-context message', () => {
	describe('docContextMessageContent', () => {
		it('marks the cursor position when nothing is selected', () => {
			const content = docContextMessageContent({
				beforeCursor: 'Hello ',
				selectedText: '',
				afterCursor: 'world',
			});

			expect(content).toContain('<<CURSOR>>');
			expect(content).not.toContain('<<SELECTION>>');
			expect(content).toContain('Hello <<CURSOR>>world');
		});

		it('wraps the selection when text is selected', () => {
			const content = docContextMessageContent({
				beforeCursor: 'Hello ',
				selectedText: 'big',
				afterCursor: ' world',
			});

			expect(content).toContain('<<SELECTION>>big<</SELECTION>>');
			expect(content).not.toContain('<<CURSOR>>');
		});
	});

	describe('withCurrentDocContext', () => {
		const docContext: DocContext = {
			beforeCursor: 'a',
			selectedText: '',
			afterCursor: 'b',
		};

		it('seeds doc-context + greeting when the chat is empty', () => {
			const result = withCurrentDocContext([], docContext);

			expect(result).toHaveLength(2);
			expect(result[0].role).toBe('user');
			expect(result[0].content).toBe(
				docContextMessageContent(docContext),
			);
			expect(result[1].role).toBe('assistant');
		});

		it('replaces only the doc-context message (index 0) on an existing chat', () => {
			const existing: ChatMessage[] = [
				{ role: 'user', content: 'STALE CONTEXT' },
				{ role: 'assistant', content: 'greeting' },
				{ role: 'user', content: 'a real question' },
			];

			const result = withCurrentDocContext(existing, docContext);

			// Fresh context injected at index 0...
			expect(result[0].content).toBe(
				docContextMessageContent(docContext),
			);
			// ...without disturbing the rest of the conversation.
			expect(result[1]).toEqual(existing[1]);
			expect(result[2]).toEqual(existing[2]);
		});

		// ai@7 throws InvalidPromptError ("System messages are not allowed in
		// the prompt or messages fields") when a system message reaches
		// `messages`; the chat's system prompt goes in `instructions` instead.
		it('never puts a system message in the transcript', () => {
			const seeded = withCurrentDocContext([], docContext);
			const continued = withCurrentDocContext(
				[...seeded, { role: 'user', content: 'a real question' }],
				docContext,
			);

			expect(
				[...seeded, ...continued].some((m) => m.role === 'system'),
			).toBe(false);
		});

		it('does not mutate the input array', () => {
			const existing: ChatMessage[] = [
				{ role: 'user', content: 'STALE CONTEXT' },
				{ role: 'assistant', content: 'greeting' },
			];
			const snapshot = structuredClone(existing);

			withCurrentDocContext(existing, docContext);

			expect(existing).toEqual(snapshot);
		});
	});
});
