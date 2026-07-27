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

		it('seeds system + doc-context + greeting when the chat is empty', () => {
			const result = withCurrentDocContext([], docContext);

			expect(result).toHaveLength(3);
			expect(result[0].role).toBe('system');
			expect(result[1].role).toBe('user');
			expect(result[1].content).toBe(
				docContextMessageContent(docContext),
			);
			expect(result[2].role).toBe('assistant');
		});

		it('replaces only the doc-context message (index 1) on an existing chat', () => {
			const existing: ChatMessage[] = [
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'STALE CONTEXT' },
				{ role: 'assistant', content: 'greeting' },
				{ role: 'user', content: 'a real question' },
			];

			const result = withCurrentDocContext(existing, docContext);

			// Fresh context injected at index 1...
			expect(result[1].content).toBe(
				docContextMessageContent(docContext),
			);
			// ...without disturbing the rest of the conversation.
			expect(result[0]).toEqual(existing[0]);
			expect(result[2]).toEqual(existing[2]);
			expect(result[3]).toEqual(existing[3]);
		});

		it('does not mutate the input array', () => {
			const existing: ChatMessage[] = [
				{ role: 'system', content: 'sys' },
				{ role: 'user', content: 'STALE CONTEXT' },
				{ role: 'assistant', content: 'greeting' },
			];
			const snapshot = structuredClone(existing);

			withCurrentDocContext(existing, docContext);

			expect(existing).toEqual(snapshot);
		});
	});
});
