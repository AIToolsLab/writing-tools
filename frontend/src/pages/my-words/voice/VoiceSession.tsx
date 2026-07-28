/**
 * The My Words "Voice" tab: a spoken conversation over the writer's real
 * document. It reuses the durable edit path (EditorAPI + validateOp + the five
 * tool shapes) but owns its own turn-loop — the voice model drives turns, so the
 * pull-based Responder/strategy machinery is deliberately bypassed here.
 *
 * The writer's spoken words must be able to be shaped, so their rolling
 * transcript is fed into the corpus's `userMessages` slot — the voice analogue
 * of the text path appending sent messages to the scratchpad. Without it,
 * `validateOp` would reject the model shaping words the writer just said aloud.
 *
 * Layout: the scratchpad (a second document the agent edits with the same
 * tools) takes most of the space; a compact "You said" strip shows the
 * writer's recent turns; the raw tool/system log lives behind a Debug
 * disclosure. The header carries Undo — labelled with the move it would revert,
 * so the writer knows what they're reverting — and, during a pre-edit reveal, a
 * ✕ chip that vetoes the pending edit.
 *
 * Failed attempts (a blocked edit, a cancelled one, one that wouldn't apply)
 * surface in a notice strip rather than only in the debug log: silence after a
 * refusal reads as broken. See invariant 3 in `session.ts`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildCorpus } from '../corpus';
import {
	startVoiceSession,
	type TranscriptSpeaker,
	type VoiceSession as Session,
} from './session';
import { VoiceScratchpad } from './VoiceScratchpad';

type Status = 'idle' | 'connecting' | 'live' | 'error';
// `id` is the transcript segment id, so interim → final updates replace the same
// line. Tool/system/notice entries have no id and always append.
type LogEntry = {
	kind: TranscriptSpeaker | 'tool' | 'system' | 'notice';
	text: string;
	id?: string;
};

/** Clip a describeOp string to something that fits a narrow taskpane button. */
const clipLabel = (s: string, n = 30) =>
	s.length > n ? `${s.slice(0, n - 1)}…` : s;

export function VoiceSession(props: {
	editor: EditorAPI;
	scratchpad: string;
	onScratchpadChange: (v: string) => void;
}) {
	const { editor, scratchpad, onScratchpadChange } = props;

	const audioRef = useRef<HTMLAudioElement>(null);
	const sessionRef = useRef<Session | null>(null);

	// The writer's spoken turns, so the corpus lets the model shape what they
	// just said. Keyed by segment id and updated on every transcript update
	// (interim included), so a word enters the word-bank as soon as ASR has a
	// guess — not only when the (often-delayed) final segment lands. That
	// shrinks the window where the model tries to shape a just-spoken word and
	// gets a spurious REJECTED. A ref so `corpus()` always sees the latest.
	const spokenRef = useRef<Map<string, string>>(new Map());
	const scratchpadRef = useRef(scratchpad);
	scratchpadRef.current = scratchpad;
	// The agent's scratchpad edits update the ref synchronously (before React
	// re-renders) so a back-to-back tool call validates against fresh text.
	const setScratchpad = useCallback(
		(text: string) => {
			scratchpadRef.current = text;
			onScratchpadChange(text);
		},
		[onScratchpadChange],
	);

	const [status, setStatus] = useState<Status>('idle');
	const [log, setLog] = useState<LogEntry[]>([]);
	const [agentHighlight, setAgentHighlight] = useState<string | null>(null);
	const [reveal, setReveal] = useState<{
		anchor?: string;
		cancel: () => void;
	} | null>(null);
	// The most recent thing that didn't happen, shown until it's replaced or
	// dismissed. Every notice also lands in the log.
	const [notice, setNotice] = useState<string | null>(null);
	// Depth drives the button's presence; description tells the writer what
	// pressing it would revert.
	const [undoState, setUndoState] = useState<{
		depth: number;
		description?: string;
	}>({ depth: 0 });
	const pushLog = useCallback((entry: LogEntry) => {
		setLog((prev) => [...prev, entry]);
	}, []);

	const corpus = useCallback(
		async () =>
			buildCorpus({
				docText: await editor.getDocText(),
				scratchpad: scratchpadRef.current,
				userMessages: [...spokenRef.current.values()],
			}),
		[editor],
	);

	// Replace a transcript segment's line in place (interim → final share an id)
	// instead of appending one per update. Tool/system entries have no id and
	// always append.
	const upsertLog = useCallback((entry: LogEntry) => {
		setLog((prev) => {
			const idx = entry.id
				? prev.findIndex((e) => e.id === entry.id)
				: -1;
			if (idx === -1) return [...prev, entry];
			const next = prev.slice();
			next[idx] = entry;
			return next;
		});
	}, []);

	const start = useCallback(async () => {
		if (sessionRef.current || !audioRef.current) return;
		setStatus('connecting');
		setLog([]);
		spokenRef.current = new Map();
		setUndoState({ depth: 0 });
		setNotice(null);
		try {
			const session = await startVoiceSession({
				editor,
				corpus,
				audioEl: audioRef.current,
				scratchpad: {
					get: () => scratchpadRef.current,
					set: setScratchpad,
				},
				onTranscript: (seg) => {
					// Feed the writer's words (interim included) into the corpus,
					// replacing this segment's prior text as ASR refines it.
					if (seg.who === 'you')
						spokenRef.current.set(seg.id, seg.text);
					upsertLog({ kind: seg.who, text: seg.text, id: seg.id });
				},
				onTool: (text) => pushLog({ kind: 'tool', text }),
				onStatus: (text) => pushLog({ kind: 'system', text }),
				// Writer-visible: an attempt that didn't land (see invariant 3).
				onNotice: (text) => {
					setNotice(text);
					pushLog({ kind: 'notice', text });
				},
				onScratchpadHighlight: setAgentHighlight,
				onReveal: setReveal,
				onUndoChange: setUndoState,
			});
			sessionRef.current = session;
			setStatus('live');
		} catch (e) {
			setStatus('error');
			pushLog({
				kind: 'system',
				text: `failed: ${(e as Error).message}`,
			});
		}
	}, [editor, corpus, pushLog, upsertLog, setScratchpad]);

	const stop = useCallback(async () => {
		await sessionRef.current?.stop();
		sessionRef.current = null;
		setStatus('idle');
		setReveal(null);
		setAgentHighlight(null);
		pushLog({ kind: 'system', text: 'stopped' });
	}, [pushLog]);

	const undo = useCallback(async () => {
		const report = await sessionRef.current?.undo();
		if (report) pushLog({ kind: 'system', text: report });
	}, [pushLog]);

	// Tear the session down if the tab unmounts.
	useEffect(() => {
		return () => {
			void sessionRef.current?.stop();
			sessionRef.current = null;
		};
	}, []);

	// The writer's recent spoken turns — the history that actually matters.
	const said = log.filter((e) => e.kind === 'you').slice(-3);

	return (
		<div style={S.page}>
			<audio ref={audioRef} autoPlay />
			<div style={S.header}>
				<strong style={{ fontSize: '0.85rem' }}>Voice</strong>
				<span style={S.status(status)}>{status}</span>
				{reveal ? (
					<button
						type="button"
						style={S.veto}
						title="Cancel this edit before it lands"
						onClick={() => reveal.cancel()}
					>
						✕ cancel edit
					</button>
				) : null}
				{status === 'live' && undoState.depth > 0 ? (
					<button
						type="button"
						style={S.undoBtn}
						// Naming the move matters: an unlabelled Undo makes the writer
						// guess what they're about to revert.
						title={
							undoState.description
								? `Undo — ${undoState.description}`
								: "Undo the partner's last edit"
						}
						onClick={() => void undo()}
					>
						{undoState.description
							? `Undo: ${clipLabel(undoState.description)}`
							: 'Undo'}
					</button>
				) : null}
				{status === 'live' ? (
					<button
						type="button"
						style={S.btn}
						onClick={() => void stop()}
					>
						Stop
					</button>
				) : (
					<button
						type="button"
						style={S.btn}
						disabled={status === 'connecting'}
						onClick={() => void start()}
					>
						Start talking
					</button>
				)}
			</div>

			{notice ? (
				<button
					type="button"
					style={S.notice}
					title="Dismiss"
					onClick={() => setNotice(null)}
				>
					{notice}
				</button>
			) : null}

			<VoiceScratchpad
				value={scratchpad}
				onChange={setScratchpad}
				highlight={agentHighlight}
				onQuoteClick={(phrase) =>
					void editor.selectPhrase(phrase).catch(() => {})
				}
			/>

			<div style={S.said}>
				{said.length === 0 ? (
					<div style={S.saidEmpty}>
						Click “Start talking”, grant mic access, and say
						something like “read what I have, then help me tighten
						the first line.”
					</div>
				) : (
					said.map((e, i) => (
						<div key={e.id ?? i} style={S.saidRow}>
							<span style={S.logTag}>you</span> {e.text}
						</div>
					))
				)}
			</div>

			<details style={S.debug}>
				<summary style={S.debugSummary}>
					Debug log ({log.length})
				</summary>
				<div style={S.log}>
					{log.map((e, i) => (
						<div key={i} style={S.logRow(e.kind)}>
							<span style={S.logTag}>{e.kind}</span> {e.text}
						</div>
					))}
				</div>
			</details>
		</div>
	);
}

const S = {
	page: {
		height: '100%',
		display: 'flex',
		flexDirection: 'column',
		fontFamily: 'system-ui, sans-serif',
		color: '#111827',
	} as const,
	header: {
		display: 'flex',
		alignItems: 'center',
		gap: '0.6rem',
		padding: '0.6rem 0.75rem',
		borderBottom: '1px solid #e5e7eb',
	} as const,
	status: (s: Status) =>
		({
			fontSize: '0.72rem',
			padding: '0.1rem 0.5rem',
			borderRadius: 999,
			color: '#fff',
			background:
				s === 'live'
					? '#16a34a'
					: s === 'error'
						? '#dc2626'
						: s === 'connecting'
							? '#d97706'
							: '#6b7280',
		}) as const,
	btn: {
		marginLeft: 'auto',
		padding: '0.35rem 0.9rem',
		border: '1px solid #4f46e5',
		borderRadius: 6,
		background: '#4f46e5',
		color: '#fff',
		cursor: 'pointer',
		fontSize: '0.85rem',
	} as const,
	undoBtn: {
		padding: '0.25rem 0.6rem',
		border: '1px solid #d1d5db',
		borderRadius: 6,
		background: '#f9fafb',
		color: '#374151',
		cursor: 'pointer',
		fontSize: '0.75rem',
	} as const,
	veto: {
		padding: '0.25rem 0.6rem',
		border: '1px solid #dc2626',
		borderRadius: 999,
		background: '#fef2f2',
		color: '#b91c1c',
		cursor: 'pointer',
		fontSize: '0.75rem',
		fontWeight: 600,
	} as const,
	said: {
		padding: '0.5rem 0.75rem',
		borderBottom: '1px solid #e5e7eb',
		fontSize: '0.78rem',
		maxHeight: '5.5rem',
		overflowY: 'auto',
	} as const,
	// A failed attempt, in the main flow rather than the debug log: an agent that
	// goes quiet after a refusal reads as broken. Click to dismiss.
	notice: {
		display: 'block',
		width: '100%',
		textAlign: 'left',
		padding: '0.4rem 0.75rem',
		border: 'none',
		borderBottom: '1px solid #fde68a',
		background: '#fffbeb',
		color: '#92400e',
		fontSize: '0.75rem',
		fontFamily: 'inherit',
		cursor: 'pointer',
	} as const,
	saidRow: { margin: '0 0 0.25rem', color: '#065f46' } as const,
	saidEmpty: { color: '#6b7280', fontStyle: 'italic' } as const,
	debug: {
		flexShrink: 0,
		maxHeight: '40%',
		overflowY: 'auto',
		padding: '0.25rem 0.75rem 0.5rem',
	} as const,
	debugSummary: {
		cursor: 'pointer',
		fontSize: '0.72rem',
		color: '#6b7280',
	} as const,
	log: {
		paddingTop: '0.4rem',
		fontSize: '0.75rem',
	} as const,
	logRow: (kind: LogEntry['kind']) =>
		({
			margin: '0 0 0.4rem',
			color:
				kind === 'tool'
					? '#4338ca'
					: kind === 'notice'
						? '#92400e'
						: kind === 'system'
							? '#6b7280'
							: kind === 'you'
								? '#065f46'
								: '#111827',
		}) as const,
	logTag: {
		fontSize: '0.65rem',
		textTransform: 'uppercase',
		opacity: 0.6,
		marginRight: 4,
	} as const,
};
