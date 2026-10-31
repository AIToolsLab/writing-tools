/**
 * The edit note: what the writer changed since the model last saw the
 * document, so it hears about their edits without having to `view` (#583).
 *
 * A paragraph-level diff, deliberately simple for now: reworded paragraphs
 * show their new text (and a clip of the old, which the model has seen
 * earlier in the conversation), additions show their text, removals a clip.
 * Moved paragraphs read as a removal plus an addition. Paragraph numbers are
 * the current document's, the same coordinates `view` and the edit tools use.
 */

/** How much of a paragraph's new and old text to show. */
const NEW_CLIP = 400;
const OLD_CLIP = 80;
/** Past this many characters, the note just says to `view`. */
const NOTE_CAP = 1500;

const clip = (s: string, n: number) =>
	s.length > n ? `${s.slice(0, n - 1)}…` : s;

type Para = { n: number; text: string };

/** Non-blank paragraphs with their real 1-based numbers (as `view` shows them). */
function numbered(paragraphs: string[]): Para[] {
	return paragraphs
		.map((text, i) => ({ n: i + 1, text }))
		.filter((p) => p.text.trim() !== '');
}

type Change =
	| { kind: 'reworded'; n: number; old: string; text: string }
	| { kind: 'added'; n: number; text: string }
	| { kind: 'removed'; after: number; old: string };

/** Paragraph diff via LCS, with adjacent removals and additions paired up. */
export function diffParagraphs(before: string[], after: string[]): Change[] {
	const a = numbered(before);
	const b = numbered(after);
	// lcs[i][j] = LCS length of a[i:] and b[j:].
	const lcs = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] =
				a[i].text === b[j].text
					? lcs[i + 1][j + 1] + 1
					: Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	const changes: Change[] = [];
	let removed: Para[] = [];
	let added: Para[] = [];
	// The current paragraph a removal sits after (0: the top).
	let anchor = 0;
	const flush = () => {
		const paired = Math.min(removed.length, added.length);
		for (let k = 0; k < paired; k++) {
			changes.push({
				kind: 'reworded',
				n: added[k].n,
				old: removed[k].text,
				text: added[k].text,
			});
		}
		for (const p of added.slice(paired)) {
			changes.push({ kind: 'added', n: p.n, text: p.text });
		}
		for (const p of removed.slice(paired)) {
			changes.push({ kind: 'removed', after: anchor, old: p.text });
		}
		removed = [];
		added = [];
	};

	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i].text === b[j].text) {
			flush();
			anchor = b[j].n;
			i++;
			j++;
		} else if (
			j < b.length &&
			(i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])
		) {
			added.push(b[j++]);
		} else {
			removed.push(a[i++]);
		}
	}
	flush();
	return changes;
}

/**
 * The note for the model, or null when nothing changed. `before` is what the
 * model last saw; `after` is the document now.
 */
export function editNote(before: string[], after: string[]): string | null {
	const changes = diffParagraphs(before, after);
	if (changes.length === 0) return null;
	const lines = changes.map((c) => {
		if (c.kind === 'reworded') {
			return `[${c.n}] reworded: "${clip(c.text, NEW_CLIP)}" (was "${clip(c.old, OLD_CLIP)}")`;
		}
		if (c.kind === 'added') {
			return `[${c.n}] added: "${clip(c.text, NEW_CLIP)}"`;
		}
		const where = c.after === 0 ? 'at the top' : `after [${c.after}]`;
		return `removed ${where}: "${clip(c.old, OLD_CLIP)}"`;
	});
	const note = `Since you last saw the document, the writer changed it (current paragraph numbers):\n${lines.join('\n')}`;
	return note.length > NOTE_CAP
		? 'Since you last saw the document, the writer revised it substantially; call `view` to see it, if needed.'
		: note;
}
