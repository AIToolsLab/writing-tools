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

	getDocContext = async (): Promise<DocContext> => ({
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

	selectPhrase = async (text: string) => {
		this.selection = text;
		this.emit();
		this.selectionHandlers.forEach((h) => h());
	};

	getDocText = async () => this.paragraphs.join('\n\n');
	getParagraphs = async () => [...this.paragraphs];

	applyEdit = async (edit: DocEdit) => {
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
	};

	applySplice = async (splice: ParagraphSplice) => {
		this.paragraphs = applySplice(this.paragraphs, splice);
		this.selection = '';
		this.emit();
	};

	// The demo seeds the scratchpad from its scenario; no persistence.
	loadScratchpad = async () => '';
	saveScratchpad = async () => {};

	/**
	 * Document settings live in memory for the life of the harness — the demo
	 * has no file to write into, but the brief has to round-trip or the panels
	 * that read it render empty.
	 */
	private settings = new Map<string, string>();

	getDocumentSetting = async (key: string): Promise<string | null> =>
		this.settings.get(key) ?? null;

	setDocumentSetting = async (key: string, value: string): Promise<void> => {
		this.settings.set(key, value);
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
