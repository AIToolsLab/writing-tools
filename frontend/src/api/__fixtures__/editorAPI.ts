/**
 * A complete, inert `EditorAPI` for tests that only care about part of it.
 *
 * `EditorAPI` is the union of what every surface can do, so it grows whenever a
 * page needs a new capability — document settings for the brief, paragraph
 * access for My Words. A test that spells the interface out in full then breaks
 * on widenings it has nothing to do with, which is exactly what happened when
 * those two landed on separate branches.
 *
 * Spread this and override only the methods under test, so a test fails for its
 * own reasons.
 */
export function noopEditorAPI(overrides: Partial<EditorAPI> = {}): EditorAPI {
	return {
		getDocContext: () =>
			Promise.resolve({
				beforeCursor: '',
				selectedText: '',
				afterCursor: '',
			}),
		addSelectionChangeHandler: () => {},
		removeSelectionChangeHandler: () => {},
		selectPhrase: () => Promise.resolve(),
		getDocText: () => Promise.resolve(''),
		getParagraphs: () => Promise.resolve([]),
		applyEdit: () => Promise.resolve(),
		loadScratchpad: () => Promise.resolve(''),
		saveScratchpad: () => Promise.resolve(),
		getDocumentSetting: () => Promise.resolve(null),
		setDocumentSetting: () => Promise.resolve(),
		...overrides,
	};
}
