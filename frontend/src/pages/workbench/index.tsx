/**
 * Workbench — take a sentence, paragraph or selection off to the side and work
 * on it with token-level help from an open-weights model.
 *
 * Two modes, both from AIToolsLab/writing-prototypes:
 * - **Highlights** mark where a model carrying out the instruction would have
 *   written something different. They point; they never replace.
 * - **Predict** has the writer write the rewrite themselves, with next-word
 *   predictions. The AI's words can't get ahead of the writer's: a suggestion
 *   is a few words past what they've typed. A suggestion can also correct the
 *   word being typed (a likely spelling), which the writer sees marked as such.
 *
 * Nothing here writes to the document. Requests go straight to the writing
 * engine (`@/api/writingEngine`), not through the backend.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/button';
import { workbenchLog } from '@/api/logging';
import {
	ENGINE_URL,
	EngineClient,
	fetchPost,
	showToken,
} from '@/api/writingEngine';
import BriefSection from '@/components/briefSection';
import { ErrorNotice } from '@/components/errorNotice';
import {
	formatDocBriefForPrompt,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import { useLog } from '@/hooks/useLog';
import {
	type HighlightRange,
	tokenHighlights,
	NUM_SUGGESTIONS,
	Predictor,
	type Suggestion,
} from './engine';
import {
	DEFAULT_INSTRUCTION,
	extractPassage,
	followEdits,
	type Passage,
	type PassageScope,
	REWRITE_ADJECTIVES,
	taskMessages,
} from './passage';
import classes from './styles.module.css';

/** Shared across mounts so rendered chat prefixes stay cached. */
const client = new EngineClient(fetchPost(ENGINE_URL));

/**
 * Highlights wait for a pause in typing: unlike predictions, the server doesn't
 * drop a superseded scoring request, so one per keystroke would queue up.
 */
const HIGHLIGHT_DELAY_MS = 150;
const ALT_KEY =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad/.test(navigator.userAgent)
		? '⌥'
		: 'Alt+';

type Mode = 'highlights' | 'predict';

function describeError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function isAbort(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'AbortError';
}

/** Grow a textarea to fit its text, so the pane scrolls instead of it. */
function useAutogrow(value: string) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		const ta = ref.current;
		if (!ta) return;
		ta.style.height = 'auto';
		ta.style.height = `${ta.scrollHeight + (ta.offsetHeight - ta.clientHeight)}px`;
	}, [value]);
	return ref;
}

export default function Workbench(): React.JSX.Element {
	const editorAPI = useContext(EditorContext);
	const { brief } = useDocBrief();
	const briefText = formatDocBriefForPrompt(brief);
	const log = useLog();

	const [model, setModel] = useState<string | null>(null);
	const [modelError, setModelError] = useState<string | null>(null);
	const [scope, setScope] = useState<PassageScope>('paragraph');
	const [passage, setPassage] = useState<Passage | null>(null);
	const [text, setText] = useState('');
	const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
	const [mode, setMode] = useState<Mode>('highlights');
	const [pulling, setPulling] = useState(false);

	useEffect(() => {
		client
			.loadModel()
			.then(setModel, (err) => setModelError(describeError(err)));
	}, []);

	const pull = useCallback(async () => {
		setPulling(true);
		try {
			const ctx = await editorAPI.getDocContext();
			const next = extractPassage(ctx, scope);
			setPassage(next);
			setText(next.text);
			workbenchLog.passagePulled(log, {
				source: next.source,
				chars: next.text.length,
				hasPreviousParagraph: next.previousParagraph.length > 0,
			});
		} finally {
			setPulling(false);
		}
	}, [editorAPI, scope, log]);

	const previousParagraph = passage?.previousParagraph ?? '';
	const messages = taskMessages({
		instruction,
		source: text,
		brief: briefText,
		previousParagraph,
	});

	return (
		<div className={classes.container}>
			<p className={classes.intro}>
				Take a passage off to the side. <b>Highlights</b> mark where an
				AI following the instruction would have written something
				different. <b>Predict</b> lets you write your own version, with
				next-word suggestions.
			</p>

			<BriefSection page="workbench" />

			<section className={classes.section}>
				<div className={classes.row}>
					<fieldset className={classes.segmented}>
						<legend className={classes.srOnly}>What to pull</legend>
						{(['sentence', 'paragraph'] as const).map((s) => (
							<label key={s}>
								<input
									type="radio"
									name="scope"
									value={s}
									checked={scope === s}
									onChange={() => setScope(s)}
								/>
								{s === 'sentence' ? 'Sentence' : 'Paragraph'}
							</label>
						))}
					</fieldset>
					<Button
						onClick={() => void pull()}
						loading={pulling}
						size="small"
					>
						{passage ? 'Pull again' : 'Pull from document'}
					</Button>
				</div>
				<p className={classes.hint}>
					Uses your selection if you have one; otherwise the {scope}{' '}
					at your cursor.
				</p>
			</section>

			<InstructionPicker value={instruction} onChange={setInstruction} />

			<div className={classes.tabs} role="tablist">
				{(['highlights', 'predict'] as const).map((m) => (
					<button
						key={m}
						type="button"
						role="tab"
						aria-selected={mode === m}
						onClick={() => setMode(m)}
					>
						{m === 'highlights' ? 'Highlights' : 'Predict'}
					</button>
				))}
			</div>

			{modelError ? (
				<ErrorNotice
					title="Couldn't reach the model server"
					message="The Workbench uses a separate server, and it didn't answer."
					detail={modelError}
				/>
			) : null}

			{mode === 'highlights' ? (
				<HighlightsView
					text={text}
					setText={setText}
					messages={messages}
					model={model}
					log={log}
				/>
			) : (
				<PredictView
					source={text}
					setSource={setText}
					messages={messages}
					model={model}
					log={log}
				/>
			)}

			<p className={classes.footnote}>
				This page sends the passage, the paragraph before it and your
				brief to <code>{new URL(ENGINE_URL).host}</code>
				{model ? ` (${model})` : ''}, which may log requests. Nothing
				here changes your document.
			</p>
		</div>
	);
}

function InstructionPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<details className={classes.picker}>
			<summary>
				<span className={classes.label}>Instruction</span>
				<span className={classes.pickerValue}>{value}</span>
			</summary>
			<div className={classes.chips}>
				{REWRITE_ADJECTIVES.map((adj) => {
					const instr = `Rewrite this passage to be ${adj}.`;
					return (
						<button
							key={adj}
							type="button"
							aria-pressed={instr === value}
							onClick={() => onChange(instr)}
						>
							{adj}
						</button>
					);
				})}
			</div>
			<label className={classes.label} htmlFor="wb-instruction">
				Or write your own
			</label>
			<textarea
				id="wb-instruction"
				className={classes.instruction}
				rows={2}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</details>
	);
}

type LogFn = ReturnType<typeof useLog>;

// ── Highlights ──────────────────────────────────────────────────────────────

function HighlightsView({
	text,
	setText,
	messages,
	model,
	log,
}: {
	text: string;
	setText: (t: string) => void;
	messages: ReturnType<typeof taskMessages>;
	model: string | null;
	log: LogFn;
}) {
	const [result, setResult] = useState<{
		text: string;
		ranges: HighlightRange[];
		scored: boolean;
	}>({ text: '', ranges: [], scored: false });
	const [status, setStatus] = useState('');
	const [warning, setWarning] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [wanted, setWanted] = useState(8);
	const [showAlts, setShowAlts] = useState(false);
	const [tooltip, setTooltip] = useState<{
		x: number;
		y: number;
		range: HighlightRange;
	} | null>(null);
	const taRef = useAutogrow(text);
	const backdropRef = useRef<HTMLDivElement>(null);
	const key = JSON.stringify(messages);

	useEffect(() => {
		if (!model) return;
		if (!text.trim()) {
			setResult({ text, ranges: [], scored: false });
			setStatus('');
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(
			() =>
				void (async () => {
					setStatus('Scoring…');
					const t0 = performance.now();
					try {
						const res = await tokenHighlights(
							client,
							{ messages, passage: text },
							controller.signal,
						);
						const ms = Math.round(performance.now() - t0);
						setResult({ text, ranges: res.ranges, scored: true });
						setWarning(res.warning);
						setError(null);
						setStatus(
							`Scored ${res.tokenCount} tokens in ${ms} ms (server ${res.serverMs} ms)`,
						);
						workbenchLog.highlightsScored(log, {
							model,
							ms,
							serverMs: res.serverMs,
							tokens: res.tokenCount,
							ranges: res.ranges.length,
						});
					} catch (err) {
						if (isAbort(err)) return;
						setStatus('');
						setError(describeError(err));
						workbenchLog.requestFailed(log, {
							kind: 'highlights',
							error: describeError(err),
						});
					}
				})(),
			HIGHLIGHT_DELAY_MS,
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
		// `key` stands for `messages`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, text, model, log]);

	// Top N by score, shown in document order, shifted to follow edits made
	// since they were computed.
	const top = new Set(
		[...result.ranges].sort((a, b) => b.score - a.score).slice(0, wanted),
	);
	const selected = followEdits(
		result.text,
		text,
		result.ranges.filter((r) => top.has(r)),
	);

	// The textarea sits on top, so the marks can't get mouse events; hit-test.
	const onMouseMove = (e: React.MouseEvent) => {
		const marks = backdropRef.current?.querySelectorAll('mark') ?? [];
		for (const [i, mark] of [...marks].entries()) {
			for (const rect of mark.getClientRects()) {
				if (
					e.clientX >= rect.left &&
					e.clientX <= rect.right &&
					e.clientY >= rect.top &&
					e.clientY <= rect.bottom
				) {
					setTooltip({
						x: rect.left + rect.width / 2,
						y: rect.top,
						range: selected[i],
					});
					return;
				}
			}
		}
		setTooltip(null);
	};

	const message = !text.trim()
		? 'Pull a passage from your document, or type one here.'
		: result.scored && result.text === text && result.ranges.length === 0
			? 'No differences: the AI would have written this just as you did.'
			: '';

	return (
		<section className={classes.section}>
			<div className={classes.overlay}>
				<div
					ref={backdropRef}
					className={`${classes.backdrop} ${showAlts ? classes.showAlts : ''}`}
					aria-hidden="true"
				>
					{renderMarks(text, selected)}
				</div>
				<textarea
					ref={taRef}
					className={`${classes.editor} ${classes.overlayEditor}`}
					spellCheck={false}
					value={text}
					aria-label="Passage"
					onChange={(e) => setText(e.target.value)}
					onMouseMove={onMouseMove}
					onMouseLeave={() => setTooltip(null)}
				/>
			</div>
			{tooltip ? (
				<div
					className={classes.tooltip}
					style={{ left: tooltip.x, top: tooltip.y }}
				>
					<span className={classes.alt}>
						{showToken(tooltip.range.alternative)}
					</span>
					<span className={classes.detail}>
						{tooltip.range.detail}
					</span>
				</div>
			) : null}
			{result.ranges.length > 0 && (
				<div className={classes.controls}>
					<label>
						Show top{' '}
						<input
							type="range"
							min={0}
							max={result.ranges.length}
							value={Math.min(wanted, result.ranges.length)}
							onChange={(e) => setWanted(Number(e.target.value))}
						/>{' '}
						{Math.min(wanted, result.ranges.length)} of{' '}
						{result.ranges.length}
					</label>
					<label>
						<input
							type="checkbox"
							checked={showAlts}
							onChange={(e) => setShowAlts(e.target.checked)}
						/>{' '}
						Show alternatives above the text
					</label>
				</div>
			)}
			{selected.length > 0 && (
				<ol
					className={classes.diffList}
					aria-label="Where the AI differs"
				>
					{selected.map((r) => (
						<li key={`${r.start}-${r.end}`}>
							<span className={classes.written}>
								{showToken(text.slice(r.start, r.end))}
							</span>
							{' → '}
							<span className={classes.alt}>
								{showToken(r.alternative)}
							</span>{' '}
							<span className={classes.detail}>{r.detail}</span>
						</li>
					))}
				</ol>
			)}
			{message ? <p className={classes.message}>{message}</p> : null}
			{error ? (
				<ErrorNotice
					title="Couldn't score the passage"
					message="The model server returned an error."
					detail={error}
				/>
			) : null}
			<p className={classes.status}>{status}</p>
			{warning ? <p className={classes.warning}>{warning}</p> : null}
		</section>
	);
}

/** The backdrop: the same text, with transparent marks behind the textarea. */
function renderMarks(text: string, ranges: HighlightRange[]) {
	const out: React.ReactNode[] = [];
	let pos = 0;
	for (const r of ranges) {
		out.push(text.slice(pos, r.start));
		const inner = text.slice(r.start, r.end);
		out.push(
			<mark
				key={`${r.start}-${r.end}`}
				className={inner.trim() ? undefined : classes.whitespace}
			>
				{inner}
				<span className={classes.markAlt}>
					{showToken(r.alternative)}
				</span>
			</mark>,
		);
		pos = r.end;
	}
	out.push(text.slice(pos));
	// A trailing newline needs something after it to take up a line.
	out.push('​');
	return out;
}

// ── Predict ─────────────────────────────────────────────────────────────────

function PredictView({
	source,
	setSource,
	messages,
	model,
	log,
}: {
	source: string;
	setSource: (t: string) => void;
	messages: ReturnType<typeof taskMessages>;
	model: string | null;
	log: LogFn;
}) {
	const [draft, setDraft] = useState('');
	const [words, setWords] = useState(1);
	const [shown, setShown] = useState<{ draft: string; items: Suggestion[] }>({
		draft: '',
		items: [],
	});
	const [status, setStatus] = useState('');
	const [warning, setWarning] = useState('');
	const [error, setError] = useState<string | null>(null);
	const predictorRef = useRef(new Predictor(client));
	const sourceRef = useAutogrow(source);
	const draftRef = useAutogrow(draft);
	const contextKey = JSON.stringify([messages, words]);

	// No debounce: a request per keystroke. The server drops a request from
	// this tab once a newer one arrives (409, treated as an abort), and the
	// predictor narrows the last answer locally until the new one is back.
	useEffect(() => {
		if (!model) return;
		const controller = new AbortController();
		void (async () => {
			setStatus('Predicting…');
			const t0 = performance.now();
			try {
				const res = await predictorRef.current.suggest(
					{
						messages: [
							...messages,
							{ role: 'assistant', content: draft },
						],
						words,
						onUpdate: (items) => {
							if (!controller.signal.aborted) {
								setShown({ draft, items });
							}
						},
					},
					controller.signal,
				);
				const ms = Math.round(performance.now() - t0);
				setShown({ draft, items: res.suggestions });
				setWarning(res.warning);
				setError(null);
				setStatus(`Predicted in ${ms} ms (server ${res.serverMs} ms)`);
				workbenchLog.predictionsFetched(log, {
					model,
					ms,
					serverMs: res.serverMs,
					suggestions: res.suggestions.length,
					corrections: res.suggestions.filter((s) => s.correction)
						.length,
					words,
				});
			} catch (err) {
				if (isAbort(err)) return;
				setStatus('');
				setError(describeError(err));
				workbenchLog.requestFailed(log, {
					kind: 'predictions',
					error: describeError(err),
				});
			}
		})();
		return () => controller.abort();
		// `contextKey` stands for `messages` and `words`.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [contextKey, draft, model, log]);

	const fresh = shown.draft === draft;
	const accept = useCallback(
		(i: number) => {
			const item = shown.items[i];
			if (!item || shown.draft !== draft) return;
			const replace = item.correction?.replace ?? 0;
			workbenchLog.suggestionAccepted(log, {
				slot: i,
				acceptedChars: item.text.length,
				replacedChars: replace,
				draftChars: draft.length,
				correction: item.correction !== undefined,
			});
			const next = draft.slice(0, draft.length - replace) + item.text;
			setDraft(next);
			const ta = draftRef.current;
			if (ta) {
				ta.focus();
				requestAnimationFrame(() =>
					ta.setSelectionRange(next.length, next.length),
				);
			}
		},
		[shown, draft, log, draftRef],
	);

	// Alt+1–5 picks a suggestion. Use the key's position (code), since on a Mac
	// Option+1 types "¡".
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const m = e.code.match(/^Digit([1-9])$/);
			if (!m || !e.altKey || e.ctrlKey || e.metaKey) return;
			e.preventDefault();
			accept(Number(m[1]) - 1);
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [accept]);

	return (
		<section className={classes.section}>
			<label className={classes.label} htmlFor="wb-source">
				Original
			</label>
			<textarea
				id="wb-source"
				ref={sourceRef}
				className={classes.editor}
				value={source}
				onChange={(e) => setSource(e.target.value)}
			/>
			<label className={classes.label} htmlFor="wb-draft">
				Your version
			</label>
			<textarea
				id="wb-draft"
				ref={draftRef}
				className={classes.editor}
				placeholder="Start typing, or pick a suggestion below."
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
			/>
			<div className={classes.suggestions}>
				{Array.from({ length: NUM_SUGGESTIONS }, (_, i) => (
					<SuggestionButton
						// Index keys: fixed slots, so they don't jump around
						key={i}
						slot={i}
						item={shown.items[i]}
						draft={shown.draft}
						disabled={!fresh}
						onClick={() => accept(i)}
					/>
				))}
			</div>
			<div className={classes.controls}>
				<label>
					Words per suggestion{' '}
					<select
						value={words}
						onChange={(e) => setWords(Number(e.target.value))}
					>
						<option value={1}>1</option>
						<option value={2}>2</option>
						<option value={3}>3</option>
					</select>
				</label>
			</div>
			{error ? (
				<ErrorNotice
					title="Couldn't get predictions"
					message="The model server returned an error."
					detail={error}
				/>
			) : null}
			<p className={classes.status}>{status}</p>
			{warning ? <p className={classes.warning}>{warning}</p> : null}
		</section>
	);
}

function SuggestionButton({
	slot,
	item,
	draft,
	disabled,
	onClick,
}: {
	slot: number;
	item: Suggestion | undefined;
	draft: string;
	disabled: boolean;
	onClick: () => void;
}) {
	const c = item?.correction;
	// A completion of the word being typed shows the whole word, the typed
	// part grayed out. A correction shows the word it makes.
	const typed =
		item && !c && /^\S/.test(item.text)
			? (/\S*$/.exec(draft)?.[0] ?? '')
			: '';
	const note = c
		? c.ratio < 10
			? `${c.ratio.toFixed(1)}×`
			: c.ratio < 100
				? `${Math.round(c.ratio)}×`
				: '100×+'
		: item?.prob !== undefined
			? item.prob < 0.005
				? '<1%'
				: `${Math.round(item.prob * 100)}%`
			: null;
	return (
		<button
			type="button"
			className={c ? classes.correction : undefined}
			disabled={!item || disabled}
			title={
				c
					? `Replace "${/\S*$/.exec(draft.trimEnd())?.[0] ?? ''}" with "${c.word}" (${note} as likely as what you typed)`
					: item?.text
			}
			onClick={onClick}
		>
			<kbd>
				{ALT_KEY}
				{slot + 1}
			</kbd>
			<span className={classes.suggestionText}>
				{typed ? (
					<span className={classes.typedPart}>{typed}</span>
				) : null}
				{item ? showToken(c ? c.word : item.text) : ''}
			</span>
			{note !== null && <small>{note}</small>}
		</button>
	);
}
