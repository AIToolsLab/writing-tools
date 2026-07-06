/**
 * The My Words "Voice" tab: a spoken conversation over the writer's real
 * document. It reuses the durable edit path (EditorAPI + validateOp + the five
 * tool shapes) but owns its own turn-loop — the LiveKit agent drives turns, so
 * the pull-based Responder/strategy machinery is deliberately bypassed here.
 *
 * The writer's spoken words must be able to be shaped, so their rolling
 * transcript is fed into the corpus's `userMessages` slot — the voice analogue
 * of the text path appending sent messages to the scratchpad. Without it,
 * `validateOp` would reject the model shaping words the writer just said aloud.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildCorpus } from '../corpus';
import {
	startVoiceSession,
	type TranscriptSpeaker,
	type VoiceSession as Session,
} from './liveVoice';

type Status = 'idle' | 'connecting' | 'live' | 'error';
// `id` is the transcript segment id, so interim → final updates replace the same
// line. Tool/system entries have no id and always append.
type LogEntry = {
	kind: TranscriptSpeaker | 'tool' | 'system';
	text: string;
	id?: string;
};

export function VoiceSession(props: {
	editor: EditorAPI;
	scratchpad: string;
}) {
	const { editor, scratchpad } = props;

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

	const [status, setStatus] = useState<Status>('idle');
	const [log, setLog] = useState<LogEntry[]>([]);
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
			const idx = entry.id ? prev.findIndex((e) => e.id === entry.id) : -1;
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
		try {
			const session = await startVoiceSession({
				editor,
				corpus,
				audioEl: audioRef.current,
				onTranscript: (seg) => {
					// Feed the writer's words (interim included) into the corpus,
					// replacing this segment's prior text as ASR refines it.
					if (seg.who === 'you') spokenRef.current.set(seg.id, seg.text);
					upsertLog({ kind: seg.who, text: seg.text, id: seg.id });
				},
				onTool: (text) => pushLog({ kind: 'tool', text }),
				onStatus: (text) => pushLog({ kind: 'system', text }),
			});
			sessionRef.current = session;
			setStatus('live');
		} catch (e) {
			setStatus('error');
			pushLog({ kind: 'system', text: `failed: ${(e as Error).message}` });
		}
	}, [editor, corpus, pushLog, upsertLog]);

	const stop = useCallback(async () => {
		await sessionRef.current?.stop();
		sessionRef.current = null;
		setStatus('idle');
		pushLog({ kind: 'system', text: 'stopped' });
	}, [pushLog]);

	// Tear the session down if the tab unmounts.
	useEffect(() => {
		return () => {
			void sessionRef.current?.stop();
			sessionRef.current = null;
		};
	}, []);

	return (
		<div style={S.page}>
			<audio ref={audioRef} autoPlay />
			<div style={S.header}>
				<strong style={{ fontSize: '0.85rem' }}>Voice</strong>
				<span style={S.status(status)}>{status}</span>
				{status === 'live' ? (
					<button type="button" style={S.btn} onClick={() => void stop()}>
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

			<div style={S.log}>
				{log.length === 0 ? (
					<div style={S.logEmpty}>
						Click “Start talking”, grant mic access, and say something like
						“read what I have, then help me tighten the first line.”
					</div>
				) : (
					log.map((e, i) => (
						<div key={i} style={S.logRow(e.kind)}>
							<span style={S.logTag}>{e.kind}</span> {e.text}
						</div>
					))
				)}
			</div>
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
	log: {
		flex: 1,
		padding: '0.75rem',
		overflowY: 'auto',
		fontSize: '0.8rem',
	} as const,
	logRow: (kind: LogEntry['kind']) =>
		({
			margin: '0 0 0.4rem',
			color:
				kind === 'tool'
					? '#4338ca'
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
	logEmpty: { color: '#6b7280', fontStyle: 'italic' } as const,
};
