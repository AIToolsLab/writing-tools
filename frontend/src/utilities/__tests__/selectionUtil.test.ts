import { describe, it, expect } from 'vitest';
import { getBefore, getCurParagraph } from '../selectionUtil';

describe('selectionUtil', () => {
	describe('getBefore', () => {
		it('should combine beforeCursor, selectedText and the first word from afterCursor', () => {
			const docContext: DocContext = {
				beforeCursor: 'Hello ',
				selectedText: 'world',
				afterCursor: ' is great!',
			};

			const result = getBefore(docContext);

			expect(result).toBe('Hello world');
		});

		it('should handle empty selectedText', () => {
			const docContext: DocContext = {
				beforeCursor: 'Hello ',
				selectedText: '',
				afterCursor: 'world is great!',
			};

			const result = getBefore(docContext);

			expect(result).toBe('Hello world');
		});

		it('should handle empty afterCursor', () => {
			const docContext: DocContext = {
				beforeCursor: 'Hello ',
				selectedText: 'world',
				afterCursor: '',
			};

			const result = getBefore(docContext);

			expect(result).toBe('Hello world');
		});

		it('should handle paragraph breaks in afterCursor', () => {
			const docContext: DocContext = {
				beforeCursor: 'Hello ',
				selectedText: 'world',
				afterCursor: '\rNext paragraph',
			};

			const result = getBefore(docContext);

			expect(result).toBe('Hello world');
		});
	});

	describe('getCurParagraph', () => {
		it('should correctly identify paragraphs and current paragraph index', () => {
			const docContext: DocContext = {
				beforeCursor: 'First paragraph\rSecond ',
				selectedText: 'paragraph',
				afterCursor: ' content\rThird paragraph',
			};

			const result = getCurParagraph(docContext);

			expect(result.paragraphTexts).toEqual([
				'First paragraph',
				'Second paragraph content',
				'Third paragraph',
			]);
			expect(result.curParagraphIndex).toBe(1);
		});

		it('should handle text without paragraph breaks', () => {
			const docContext: DocContext = {
				beforeCursor: 'Only ',
				selectedText: 'one',
				afterCursor: ' paragraph',
			};

			const result = getCurParagraph(docContext);

			expect(result.paragraphTexts).toEqual(['Only one paragraph']);
			expect(result.curParagraphIndex).toBe(0);
		});

		it('should handle multiple paragraph breaks in beforeCursor', () => {
			const docContext: DocContext = {
				beforeCursor: 'First\rSecond\rThird\r',
				selectedText: 'Fourth',
				afterCursor: ' paragraph\rFifth',
			};

			const result = getCurParagraph(docContext);

			expect(result.paragraphTexts).toEqual([
				'First',
				'Second',
				'Third',
				'Fourth paragraph',
				'Fifth',
			]);
			expect(result.curParagraphIndex).toBe(3);
		});

		it('should handle empty paragraphs', () => {
			const docContext: DocContext = {
				beforeCursor: 'First\r\r',
				selectedText: '',
				afterCursor: 'Third',
			};

			const result = getCurParagraph(docContext);

			expect(result.paragraphTexts).toEqual(['First', '', 'Third']);
			expect(result.curParagraphIndex).toBe(2);
		});
	});
});
