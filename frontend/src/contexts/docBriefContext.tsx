/**
 * The writer's brief for the current document: who it's for, what they want it
 * to do for them, and what it has to satisfy.
 *
 * This started as three `useState`s at the top of Revise, which made it both
 * per-page and per-session: switching to Chat lost it, and so did a reload.
 * But it describes the *document*, not a visit to one page — so it lives with
 * the document (via `EditorAPI.getDocumentSetting`/`setDocumentSetting`, which
 * is Office settings in Word and document properties in Google Docs) and is
 * read from one context that every page shares.
 *
 * ## Why "brief", and why these three
 *
 * A brief is *stated*, not negotiated — which is the modest thing this is. That
 * matters because `docs/design/interface-concepts.md` reserves the richer
 * words: a **goal** there is a Charter criterion the writer grades and
 * renegotiates, and a **to-do** is the Charter's Worklist. Calling this either
 * would squat on a name the real feature will need.
 *
 * The fields are the rhetorical situation — facts about the document that a
 * human collaborator would also want. They deliberately are *not* instructions
 * to the model ("don't touch my opening"): nothing in the add-in rewrites the
 * writer's prose, so there is nothing for such an instruction to bite on, and
 * asking for one frames the writer as a supervisor of an output machine rather
 * than as someone thinking about their reader.
 *
 * Pages fold the brief into what they send the model with
 * {@link formatDocBriefForPrompt}, and render `BriefSection` to let the writer
 * edit it from wherever they happen to be.
 */
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { EditorContext } from './editorContext';

/** The document setting the whole brief is serialized into, as JSON. */
export const DOC_BRIEF_SETTING_KEY = 'writerBrief';

/**
 * How long to wait after a keystroke before writing to the document. Saving
 * is a round-trip on both real surfaces (Office's `saveAsync`, an Apps Script
 * call), so it must not run per character — but it has to be short enough that
 * switching tabs right after typing still saves. The unmount and `pagehide`
 * flushes cover the rest.
 */
const SAVE_DEBOUNCE_MS = 600;

export const DOC_BRIEF_FIELDS = ['audience', 'purpose', 'constraints'] as const;

export type DocBriefField = (typeof DOC_BRIEF_FIELDS)[number];

export type DocBrief = Record<DocBriefField, string>;

export const EMPTY_DOC_BRIEF: DocBrief = {
	audience: '',
	purpose: '',
	constraints: '',
};

/** How each field is titled for the writer, and labelled for the model. */
export const DOC_BRIEF_LABELS: Record<DocBriefField, string> = {
	audience: 'Audience',
	purpose: 'Purpose',
	constraints: 'Constraints',
};

/**
 * `loading` — the stored value hasn't been read back yet; `saving` — edits are
 * queued or in flight; `error` — the document refused a read or a write, which
 * the section surfaces so the writer doesn't assume their brief was kept.
 */
export type DocBriefStatus = 'loading' | 'ready' | 'saving' | 'error';

export interface DocBriefContextValue {
	brief: DocBrief;
	setField: (field: DocBriefField, value: string) => void;
	status: DocBriefStatus;
}

export const DocBriefContext = createContext<DocBriefContextValue>({
	brief: EMPTY_DOC_BRIEF,
	setField: () => {},
	status: 'ready',
});

export function useDocBrief(): DocBriefContextValue {
	return useContext(DocBriefContext);
}

/**
 * Reads the stored JSON back into a brief, keeping only the fields we know and
 * only when they're strings. A document can carry a value written by an older
 * (or newer) build of the add-in, so anything unrecognized degrades to empty
 * rather than throwing on a page the writer just opened.
 */
export function parseDocBrief(raw: string | null): DocBrief {
	if (!raw) return EMPTY_DOC_BRIEF;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.warn('Ignoring unreadable brief stored with this document.');
		return EMPTY_DOC_BRIEF;
	}
	if (typeof parsed !== 'object' || parsed === null) return EMPTY_DOC_BRIEF;

	const record = parsed as Record<string, unknown>;
	const brief = { ...EMPTY_DOC_BRIEF };
	for (const field of DOC_BRIEF_FIELDS) {
		const value = record[field];
		if (typeof value === 'string') brief[field] = value;
	}
	return brief;
}

/** The fields the writer has actually filled in, in display order. */
export function filledBriefFields(brief: DocBrief): DocBriefField[] {
	return DOC_BRIEF_FIELDS.filter((field) => brief[field].trim() !== '');
}

export function hasDocBrief(brief: DocBrief): boolean {
	return filledBriefFields(brief).length > 0;
}

/**
 * Renders the brief as a block to prepend to a request, or null when the
 * writer hasn't set anything — callers must skip it in that case rather than
 * telling the model about an empty brief, which reads as a constraint of its
 * own ("the writer specified no audience").
 */
export function formatDocBriefForPrompt(brief: DocBrief): string | null {
	const filled = filledBriefFields(brief);
	if (filled.length === 0) return null;

	const lines = filled.map(
		(field) => `- ${DOC_BRIEF_LABELS[field]}: ${brief[field].trim()}`,
	);
	return `The writer has described this document's rhetorical situation. Take it into account throughout your response.\n\n${lines.join('\n')}`;
}

export function DocBriefProvider({
	children,
}: {
	children: React.ReactNode;
}): React.JSX.Element {
	const { getDocumentSetting, setDocumentSetting } = useContext(EditorContext);

	const [brief, setBrief] = useState<DocBrief>(EMPTY_DOC_BRIEF);
	const [status, setStatus] = useState<DocBriefStatus>('loading');

	/**
	 * The latest brief, readable outside a render. `setField` needs the current
	 * value to build the next one, and the save path needs it after unmount.
	 */
	const briefRef = useRef<DocBrief>(EMPTY_DOC_BRIEF);
	/** Set while a debounced save is outstanding; null once written. */
	const pendingRef = useRef<DocBrief | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * Nothing is written until the stored value has been read: otherwise the
	 * empty initial state would race the load and blank out a brief the writer
	 * saved in an earlier session.
	 */
	const loadedRef = useRef(false);

	// Load once per surface. The document is the source of truth, so a fresh
	// mount always re-reads it rather than trusting anything left in memory.
	useEffect(() => {
		let cancelled = false;
		loadedRef.current = false;
		setStatus('loading');

		void (async () => {
			try {
				const stored = await getDocumentSetting(DOC_BRIEF_SETTING_KEY);
				if (cancelled) return;
				const loaded = parseDocBrief(stored);
				briefRef.current = loaded;
				setBrief(loaded);
				setStatus('ready');
			} catch (error) {
				if (cancelled) return;
				console.error(
					'Could not read the brief stored with this document:',
					error,
				);
				// Still editable — a failed read shouldn't freeze the section. The
				// next edit tries a write, which either works or reports its own
				// failure.
				setStatus('error');
			} finally {
				if (!cancelled) loadedRef.current = true;
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [getDocumentSetting]);

	const flush = useCallback(async () => {
		const pending = pendingRef.current;
		if (pending === null) return;
		pendingRef.current = null;

		try {
			await setDocumentSetting(
				DOC_BRIEF_SETTING_KEY,
				JSON.stringify(pending),
			);
			// A newer edit may have queued while this write was in flight; leave
			// it showing "saving" so the indicator tracks the last keystroke.
			if (pendingRef.current === null) setStatus('ready');
		} catch (error) {
			console.error('Could not save the brief to this document:', error);
			setStatus('error');
		}
	}, [setDocumentSetting]);

	const setField = useCallback(
		(field: DocBriefField, value: string) => {
			const next = { ...briefRef.current, [field]: value };
			briefRef.current = next;
			setBrief(next);

			if (!loadedRef.current) return;

			pendingRef.current = next;
			setStatus('saving');
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			saveTimerRef.current = setTimeout(() => {
				saveTimerRef.current = null;
				void flush();
			}, SAVE_DEBOUNCE_MS);
		},
		[flush],
	);

	// Don't let the debounce swallow the last edit. Unmounting (the writer
	// closed the sidebar or switched surfaces) and `pagehide` (the tab is going
	// away) both write immediately instead of waiting out the timer.
	useEffect(() => {
		function flushNow() {
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
				saveTimerRef.current = null;
			}
			void flush();
		}

		window.addEventListener('pagehide', flushNow);
		return () => {
			window.removeEventListener('pagehide', flushNow);
			flushNow();
		};
	}, [flush]);

	const value = useMemo(
		() => ({ brief, setField, status }),
		[brief, setField, status],
	);

	return (
		<DocBriefContext.Provider value={value}>
			{children}
		</DocBriefContext.Provider>
	);
}
