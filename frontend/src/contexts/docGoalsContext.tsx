/**
 * The writer's to-do for the current document: who they're writing for, what
 * the assistant should avoid or preserve, and anything else it should know.
 *
 * This started as three `useState`s at the top of Revise, which made it both
 * per-page and per-session: switching to Chat lost it, and so did a reload.
 * But it describes the *document*, not a visit to one page — so it lives with
 * the document (via `EditorAPI.getDocumentSetting`/`setDocumentSetting`, which
 * is Office settings in Word and document properties in Google Docs) and is
 * read from one context that every page shares.
 *
 * Pages fold the to-do into what they send the model with
 * {@link formatDocGoalsForPrompt}, and render {@link ToDoSection} to let the
 * writer edit it from wherever they happen to be.
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

/** The document setting the whole to-do is serialized into, as JSON. */
export const DOC_GOALS_SETTING_KEY = 'writerToDo';

/**
 * How long to wait after a keystroke before writing to the document. Saving
 * is a round-trip on both real surfaces (Office's `saveAsync`, an Apps Script
 * call), so it must not run per character — but it has to be short enough that
 * switching tabs right after typing still saves. The unmount and `pagehide`
 * flushes cover the rest.
 */
const SAVE_DEBOUNCE_MS = 600;

export const DOC_GOAL_FIELDS = ['audience', 'guardrails', 'comments'] as const;

export type DocGoalField = (typeof DOC_GOAL_FIELDS)[number];

export type DocGoals = Record<DocGoalField, string>;

export const EMPTY_DOC_GOALS: DocGoals = {
	audience: '',
	guardrails: '',
	comments: '',
};

/** How each field is titled for the writer, and labelled for the model. */
export const DOC_GOAL_LABELS: Record<DocGoalField, string> = {
	audience: 'Audience',
	guardrails: 'Guardrails',
	comments: 'Additional comments',
};

/**
 * `loading` — the stored value hasn't been read back yet; `saving` — edits are
 * queued or in flight; `error` — the document refused a read or a write, which
 * the section surfaces so the writer doesn't assume their to-do was kept.
 */
export type DocGoalsStatus = 'loading' | 'ready' | 'saving' | 'error';

export interface DocGoalsContextValue {
	goals: DocGoals;
	setGoal: (field: DocGoalField, value: string) => void;
	status: DocGoalsStatus;
}

export const DocGoalsContext = createContext<DocGoalsContextValue>({
	goals: EMPTY_DOC_GOALS,
	setGoal: () => {},
	status: 'ready',
});

export function useDocGoals(): DocGoalsContextValue {
	return useContext(DocGoalsContext);
}

/**
 * Reads the stored JSON back into goals, keeping only the fields we know and
 * only when they're strings. A document can carry a value written by an older
 * (or newer) build of the add-in, so anything unrecognized degrades to empty
 * rather than throwing on a page the writer just opened.
 */
export function parseDocGoals(raw: string | null): DocGoals {
	if (!raw) return EMPTY_DOC_GOALS;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.warn('Ignoring unreadable to-do stored with this document.');
		return EMPTY_DOC_GOALS;
	}
	if (typeof parsed !== 'object' || parsed === null) return EMPTY_DOC_GOALS;

	const record = parsed as Record<string, unknown>;
	const goals = { ...EMPTY_DOC_GOALS };
	for (const field of DOC_GOAL_FIELDS) {
		const value = record[field];
		if (typeof value === 'string') goals[field] = value;
	}
	return goals;
}

/** The fields the writer has actually filled in, in display order. */
export function filledDocGoalFields(goals: DocGoals): DocGoalField[] {
	return DOC_GOAL_FIELDS.filter((field) => goals[field].trim() !== '');
}

export function hasDocGoals(goals: DocGoals): boolean {
	return filledDocGoalFields(goals).length > 0;
}

/**
 * Renders the to-do as a block to prepend to a request, or null when the
 * writer hasn't set anything — callers must skip it in that case rather than
 * telling the model about an empty to-do, which reads as a constraint of its
 * own ("the writer specified no audience").
 */
export function formatDocGoalsForPrompt(goals: DocGoals): string | null {
	const filled = filledDocGoalFields(goals);
	if (filled.length === 0) return null;

	const lines = filled.map(
		(field) => `- ${DOC_GOAL_LABELS[field]}: ${goals[field].trim()}`,
	);
	return `The writer has set the following to-do for this document. Respect it throughout your response.\n\n${lines.join('\n')}`;
}

export function DocGoalsProvider({
	children,
}: {
	children: React.ReactNode;
}): React.JSX.Element {
	const { getDocumentSetting, setDocumentSetting } = useContext(EditorContext);

	const [goals, setGoals] = useState<DocGoals>(EMPTY_DOC_GOALS);
	const [status, setStatus] = useState<DocGoalsStatus>('loading');

	/**
	 * The latest goals, readable outside a render. `setGoal` needs the current
	 * value to build the next one, and the save path needs it after unmount.
	 */
	const goalsRef = useRef<DocGoals>(EMPTY_DOC_GOALS);
	/** Set while a debounced save is outstanding; null once written. */
	const pendingRef = useRef<DocGoals | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	/**
	 * Nothing is written until the stored value has been read: otherwise the
	 * empty initial state would race the load and blank out a to-do the writer
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
				const stored = await getDocumentSetting(DOC_GOALS_SETTING_KEY);
				if (cancelled) return;
				const loaded = parseDocGoals(stored);
				goalsRef.current = loaded;
				setGoals(loaded);
				setStatus('ready');
			} catch (error) {
				if (cancelled) return;
				console.error(
					'Could not read the to-do stored with this document:',
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
				DOC_GOALS_SETTING_KEY,
				JSON.stringify(pending),
			);
			// A newer edit may have queued while this write was in flight; leave
			// it showing "saving" so the indicator tracks the last keystroke.
			if (pendingRef.current === null) setStatus('ready');
		} catch (error) {
			console.error('Could not save the to-do to this document:', error);
			setStatus('error');
		}
	}, [setDocumentSetting]);

	const setGoal = useCallback(
		(field: DocGoalField, value: string) => {
			const next = { ...goalsRef.current, [field]: value };
			goalsRef.current = next;
			setGoals(next);

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
		() => ({ goals, setGoal, status }),
		[goals, setGoal, status],
	);

	return (
		<DocGoalsContext.Provider value={value}>
			{children}
		</DocGoalsContext.Provider>
	);
}
