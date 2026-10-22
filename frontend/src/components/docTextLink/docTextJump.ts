/**
 * Turning a `doctext:` link in model output into a selection in the writer's
 * document.
 *
 * The model quotes the document to build these links, and its quotes are often
 * slightly off at the edges — a word too many, punctuation it normalized. When
 * the full quote isn't found we trim a word off each end and try the narrower
 * quote, until there is nothing left to trim.
 *
 * Every attempt is a round-trip to the editor (on the Google Docs surface, an
 * Apps Script call of roughly a second), so the attempt count *is* the delay the
 * writer feels after clicking. The Google Docs add-on now runs the same trimming
 * inside a single call, which is what keeps the common case at one round-trip;
 * this loop stays as the cross-surface fallback and for older deployments of the
 * add-on, and it reports what it cost so the page can say so and the logs can
 * show it.
 */

const DOCTEXT_PREFIX = 'doctext:';

/**
 * The quoted document text a doctext link points at, or null if the href is
 * some other kind of link (which the page should leave alone).
 */
export function parseDocTextHref(href: string): string | null {
	if (!href.startsWith(DOCTEXT_PREFIX)) return null;
	const encoded = href.slice(DOCTEXT_PREFIX.length);
	try {
		return decodeURIComponent(encoded);
	} catch {
		// A malformed escape sequence shouldn't cost the writer the click; the
		// raw target is still worth searching for.
		return encoded;
	}
}

export interface JumpOutcome {
	/** Whether the quote, or a trimmed form of it, was found and selected. */
	found: boolean;
	/** Round-trips to the editor — what the writer waited through. */
	attempts: number;
}

export async function jumpToDocText(
	selectPhrase: (phrase: string) => Promise<void>,
	text: string,
): Promise<JumpOutcome> {
	let candidate = text;
	let attempts = 0;

	while (candidate.length > 0) {
		attempts++;
		try {
			await selectPhrase(candidate);
			return { found: true, attempts };
		} catch {
			const trimmed = candidate.split(' ').slice(1, -1).join(' ');
			// Nothing left to trim: a further pass would search the same text
			// forever.
			if (trimmed === candidate) break;
			candidate = trimmed;
			console.warn('Falling back to shorter text:', candidate);
		}
	}

	return { found: false, attempts };
}
