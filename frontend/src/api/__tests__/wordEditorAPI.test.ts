// @vitest-environment node
//
// Unit tests for the Office.js / Word integration layer (src/api/wordEditorAPI.ts).
//
// The add-in talks to Word through the `Office` and `Word` globals that Office.js
// injects at runtime. We can't run Word here, so we stub those globals and verify
// our own logic: how getDocContext assembles ranges and normalizes line endings,
// how selectPhrase searches and selects, and that the selection-change handlers
// register with the right event type. This catches the class of breakage that the
// browser-only E2E specs (which run the standalone editor, not Word) can't see.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wordEditorAPI } from '../wordEditorAPI';

// `Office` / `Word` are ambient runtime globals; tests assign fakes to them.
const g = globalThis as unknown as { Office?: unknown; Word?: unknown };

afterEach(() => {
	delete g.Office;
	delete g.Word;
});

/**
 * Stub `Word.run` with a fake RequestContext for getDocContext. The selection's
 * start/end ranges expand to the before/after ranges, each carrying `.text`
 * exactly as Word would populate after `context.sync()`.
 */
function stubWordForDocContext(parts: {
	before: string;
	selected: string;
	after: string;
}) {
	const beforeRange = { text: parts.before };
	const afterRange = { text: parts.after };
	const selection = {
		text: parts.selected,
		getRange: vi.fn((loc: string) => ({
			expandTo: vi.fn(() => (loc === 'Start' ? beforeRange : afterRange)),
		})),
	};
	const context = {
		document: {
			body: { getRange: vi.fn(() => ({})) },
			getSelection: vi.fn(() => selection),
		},
		load: vi.fn(),
		sync: vi.fn().mockResolvedValue(undefined),
	};
	g.Word = {
		run: vi.fn((cb: (c: typeof context) => Promise<unknown>) =>
			cb(context),
		),
	};
}

/** Stub `Word.run` for selectPhrase with a search returning `itemCount` hits. */
function stubWordForSearch(itemCount: number) {
	const selectSpy = vi.fn();
	const items = Array.from({ length: itemCount }, () => ({
		select: selectSpy,
	}));
	const searchSpy = vi.fn(() => ({ items }));
	const context = {
		document: { body: { search: searchSpy } },
		load: vi.fn(),
		sync: vi.fn().mockResolvedValue(undefined),
	};
	g.Word = {
		run: vi.fn((cb: (c: typeof context) => Promise<unknown>) =>
			cb(context),
		),
	};
	return { selectSpy, searchSpy };
}

/** Stub the `Office.context.document` selection-change handler surface. */
function stubOffice() {
	const addHandlerAsync = vi.fn();
	const removeHandlerAsync = vi.fn();
	g.Office = {
		context: { document: { addHandlerAsync, removeHandlerAsync } },
		EventType: { DocumentSelectionChanged: 'documentSelectionChanged' },
	};
	return { addHandlerAsync, removeHandlerAsync };
}

describe('wordEditorAPI.getDocContext', () => {
	it('returns the before/selected/after text read from the Word ranges', async () => {
		stubWordForDocContext({
			before: 'Hello ',
			selected: 'beautiful',
			after: ' world',
		});

		const result = await wordEditorAPI.getDocContext();

		expect(result).toEqual({
			beforeCursor: 'Hello ',
			selectedText: 'beautiful',
			afterCursor: ' world',
		});
	});

	it('normalizes carriage returns to newlines in all three fields', async () => {
		stubWordForDocContext({
			before: 'First\rSecond ',
			selected: 'mid\rdle',
			after: ' end\rtail',
		});

		const result = await wordEditorAPI.getDocContext();

		expect(result).toEqual({
			beforeCursor: 'First\nSecond ',
			selectedText: 'mid\ndle',
			afterCursor: ' end\ntail',
		});
	});

	it('rejects when Word.run fails', async () => {
		g.Word = {
			run: vi.fn(() => Promise.reject(new Error('Word boom'))),
		};

		await expect(wordEditorAPI.getDocContext()).rejects.toThrow('Word boom');
	});
});

describe('wordEditorAPI.selectPhrase', () => {
	it('selects the first match and passes Word search options', async () => {
		const { selectSpy, searchSpy } = stubWordForSearch(2);

		await expect(
			wordEditorAPI.selectPhrase('find me'),
		).resolves.toBeUndefined();

		expect(searchSpy).toHaveBeenCalledWith('find me', {
			ignorePunct: true,
			ignoreSpace: true,
			matchCase: false,
			matchWildcards: false,
		});
		expect(selectSpy).toHaveBeenCalledTimes(1);
	});

	it('throws "Phrase not found" when there are no matches', async () => {
		const { selectSpy } = stubWordForSearch(0);

		await expect(wordEditorAPI.selectPhrase('missing')).rejects.toThrow(
			'Phrase not found',
		);
		expect(selectSpy).not.toHaveBeenCalled();
	});
});

describe('wordEditorAPI selection-change handlers', () => {
	it('registers the handler for the DocumentSelectionChanged event', () => {
		const { addHandlerAsync } = stubOffice();
		const handler = vi.fn();

		wordEditorAPI.addSelectionChangeHandler(handler);

		expect(addHandlerAsync).toHaveBeenCalledWith(
			'documentSelectionChanged',
			handler,
		);
	});

	it('removes the handler for the DocumentSelectionChanged event', () => {
		const { removeHandlerAsync } = stubOffice();
		const handler = vi.fn();

		wordEditorAPI.removeSelectionChangeHandler(handler);

		expect(removeHandlerAsync).toHaveBeenCalledWith(
			'documentSelectionChanged',
			handler,
		);
	});
});
