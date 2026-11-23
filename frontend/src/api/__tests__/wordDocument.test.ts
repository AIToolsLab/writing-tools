import { afterEach, describe, expect, it, vi } from 'vitest';
import { wordEditorAPI } from '../wordEditorAPI';

// Model Word ranges by offsets, rather than returning precomputed context fields.
// Text stays inaccessible until load + sync, as it does in Office.js.
function installWord(text: string, start: number, end = start) {
	let documentText = text;
	let selected = [start, end];
	const pending: Array<() => void> = [];
	class Range {
		private loaded?: string;
		constructor(
			readonly start: number,
			readonly end: number,
		) {}
		get text() {
			if (this.loaded === undefined)
				throw new Error('Text was not loaded');
			return this.loaded;
		}
		load() {
			this.loaded = documentText.slice(this.start, this.end);
		}
		getRange(position: string) {
			const offset = position === 'Start' ? this.start : this.end;
			return new Range(offset, offset);
		}
		expandTo(other: Range) {
			return new Range(
				Math.min(this.start, other.start),
				Math.max(this.end, other.end),
			);
		}
		insertText(value: string, position: string) {
			pending.push(() => {
				const from = position === 'After' ? this.end : this.start;
				documentText =
					documentText.slice(0, from) +
					value +
					documentText.slice(this.end);
			});
		}
		select() {
			pending.push(() => {
				selected = [this.start, this.end];
			});
		}
	}
	const body = {
		getRange: (position: string) =>
			new Range(0, documentText.length).getRange(position),
		search: (phrase: string) => {
			const items: Range[] = [];
			let offset = documentText.indexOf(phrase);
			while (offset !== -1) {
				items.push(new Range(offset, offset + phrase.length));
				offset = documentText.indexOf(phrase, offset + phrase.length);
			}
			return { items };
		},
	};
	const sync = vi.fn(() => {
		pending.splice(0).forEach((operation) => operation());
		return Promise.resolve();
	});
	const context = {
		document: {
			body,
			getSelection: () => new Range(selected[0], selected[1]),
		},
		load: (target: Range | { items: Range[] }, property: string) => {
			if (property === 'text' && target instanceof Range)
				pending.push(() => target.load());
		},
		sync,
	};
	vi.stubGlobal('Office', { context: { document: { url: '' } } });
	vi.stubGlobal('Word', {
		run: async (callback: (value: typeof context) => Promise<unknown>) => {
			const result = await callback(context);
			// Word.run flushes pending commands when its callback finishes.
			if (pending.length) await sync();
			return result;
		},
		InsertLocation: { replace: 'Replace', after: 'After' },
	});
	return { sync, read: () => documentText, selection: () => selected };
}

afterEach(() => vi.unstubAllGlobals());

describe('Word document context', () => {
	it.each([
		[
			'selection in the middle',
			'The library should stay open.',
			12,
			23,
			'The library ',
			'should stay',
			' open.',
		],
		['cursor in the middle', 'abcdef', 3, 3, 'abc', '', 'def'],
		['cursor at the start', 'abc', 0, 0, '', '', 'abc'],
		['cursor at the end', 'abc', 3, 3, 'abc', '', ''],
		['whole document selected', 'abc', 0, 3, '', 'abc', ''],
		['empty document', '', 0, 0, '', '', ''],
		['paragraph breaks', 'a\rb\rc\r', 2, 4, 'a\n', 'b\n', 'c\n'],
	] as const)(
		'reads %s without losing or duplicating text',
		async (_, text, start, end, before, selection, after) => {
			const host = installWord(text, start, end);
			const result = await wordEditorAPI.getDocContext();
			expect(result).toMatchObject({
				beforeCursor: before,
				selectedText: selection,
				afterCursor: after,
			});
			expect(
				result.beforeCursor + result.selectedText + result.afterCursor,
			).toBe(text.replace(/\r/g, '\n'));
			expect(host.read()).toBe(text);
		},
	);

	it('propagates a Word sync failure instead of returning empty context', async () => {
		const host = installWord('draft', 0);
		const error = new Error('Word connection lost');
		host.sync.mockRejectedValueOnce(error);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(wordEditorAPI.getDocContext()).rejects.toBe(error);
	});
});

describe('Word edits and navigation', () => {
	it('inserts at the cursor without dropping surrounding text', async () => {
		const host = installWord('Hello world', 6);
		await wordEditorAPI.applyEdit!({ type: 'insert', text: 'new ' });
		expect(host.read()).toBe('Hello new world');
	});
	it('replaces only the selected text when inserting', async () => {
		const host = installWord('Hello old world', 6, 9);
		await wordEditorAPI.applyEdit!({ type: 'insert', text: 'new' });
		expect(host.read()).toBe('Hello new world');
	});
	it('inserts after an anchor instead of at the cursor', async () => {
		const host = installWord('Hello world', 0);
		await wordEditorAPI.applyEdit!({
			type: 'insert',
			after: 'Hello',
			text: ' new',
		});
		expect(host.read()).toBe('Hello new world');
	});
	it('replaces only the first matching phrase', async () => {
		const host = installWord('old and old', 0);
		await wordEditorAPI.applyEdit!({
			type: 'str_replace',
			oldStr: 'old',
			newStr: 'new',
		});
		expect(host.read()).toBe('new and old');
	});
	it('rejects a missing anchor without changing the document', async () => {
		const host = installWord('Hello world', 0);
		await expect(
			wordEditorAPI.applyEdit!({
				type: 'insert',
				after: 'missing',
				text: 'new',
			}),
		).rejects.toThrow('anchor');
		expect(host.read()).toBe('Hello world');
	});
	it('selects a cited phrase without modifying the text', async () => {
		const host = installWord('The library is open', 0);
		await wordEditorAPI.selectPhrase('library');
		expect(host.selection()).toEqual([4, 11]);
		expect(host.read()).toBe('The library is open');
	});
	it('rejects a citation that is no longer in the document', async () => {
		installWord('New draft', 0);
		await expect(wordEditorAPI.selectPhrase('Old draft')).rejects.toThrow(
			'Phrase not found',
		);
	});
});
