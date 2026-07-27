/**
 * In-memory `EditorAPI` for the demo/playback harness. Holds a real paragraph
 * array and applies edits through the same pure `applyOp` the strategies use, so
 * the demo exercises the actual interaction code — not a stub. Adds `subscribe`
 * and `snapshot` so a document panel can render it live.
 */

import { applyOp, applySplice } from '../interaction/ops';

export class MockEditor implements EditorAPI {
	private paragraphs: string[];
	private selection = '';
	private listeners = new Set<() => void>();
	private selectionHandlers = new Set<() => void>();

	constructor(initial: string[]) {
		this.paragraphs = [...initial];
	}

	getDocContext = (): Promise<DocContext> =>
		Promise.resolve({
			beforeCursor: '',
			selectedText: this.selection,
			afterCursor: '',
		});

	addSelectionChangeHandler = (h: () => void) => {
		this.selectionHandlers.add(h);
	};
	removeSelectionChangeHandler = (h: () => void) => {
		this.selectionHandlers.delete(h);
	};

	selectPhrase = (text: string): Promise<void> => {
		this.selection = text;
		this.emit();
		this.selectionHandlers.forEach((h) => h());
		return Promise.resolve();
	};

	getDocText = (): Promise<string> =>
		Promise.resolve(this.paragraphs.join('\n\n'));
	getParagraphs = (): Promise<string[]> =>
		Promise.resolve([...this.paragraphs]);

	applyEdit = (edit: DocEdit): Promise<void> => {
		if (edit.type === 'delete_paragraph') {
			this.paragraphs = [
				...this.paragraphs.slice(0, edit.paragraph - 1),
				...this.paragraphs.slice(edit.paragraph),
			];
		} else {
			const op =
				edit.type === 'str_replace'
					? {
							kind: 'str_replace' as const,
							oldStr: edit.oldStr,
							newStr: edit.newStr,
						}
					: {
							kind: 'insert' as const,
							text: edit.text,
							after: edit.after,
							paragraph: edit.paragraph,
							position: edit.position,
						};
			this.paragraphs = applyOp(this.paragraphs, op);
		}
		this.selection = ''; // a fresh edit clears the prior highlight
		this.emit();
		return Promise.resolve();
	};

	applySplice = (splice: ParagraphSplice): Promise<void> => {
		this.paragraphs = applySplice(this.paragraphs, splice);
		this.selection = '';
		this.emit();
		return Promise.resolve();
	};

	/**
	 * Document settings live in memory for the life of the harness — the demo
	 * has no file to write into, but the scratchpad and brief have to round-trip
	 * or the panels that read them render empty. The demo seeds the scratchpad
	 * from its scenario, so nothing needs to outlive the page.
	 */
	private settings = new Map<string, string>();

	getDocumentSetting = (key: string): Promise<string | null> =>
		Promise.resolve(this.settings.get(key) ?? null);

	setDocumentSetting = (key: string, value: string): Promise<void> => {
		this.settings.set(key, value);
		return Promise.resolve();
	};

	/** Subscribe to document/selection changes; returns an unsubscribe. */
	subscribe = (cb: () => void): (() => void) => {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	};

	snapshot = () => ({
		paragraphs: [...this.paragraphs],
		selection: this.selection,
	});

	private emit() {
		this.listeners.forEach((l) => l());
	}
}
