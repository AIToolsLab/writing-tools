/**
 * Voice spike: a throwaway page that proves we can hold a live voice
 * conversation which (a) has the document text in context and (b) calls tools
 * that read and edit that document.
 *
 * It runs the *real* `EditorAPI` seam (an in-memory `MockEditor`) so the tools
 * exercise the same edit path the product would. Everything else — the
 * word-bank rule, the reasoning brief, turn-taking polish — is deliberately out
 * of scope. See docs/my-words-voice-native-research.md.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { MockEditor } from '../demo/mockEditor';
import { applyEditOp } from '../interaction/editor';
import {
	startRealtimeSession,
	type RealtimeSession,
	type RealtimeTool,
} from './realtime';

const SEED_PARAGRAPHS = [
	'I have been putting off writing this note for weeks.',
	'Every time I sit down, the words come out stiff and I delete them.',
	'Maybe if I just say what I mean out loud, it will finally sound like me.',
];

const INSTRUCTIONS_INTRO = `You are a warm, curious writing partner having a spoken conversation about the writer's document. Keep spoken replies to one or two sentences. Use the tools to read and edit the document: call \`view\` to re-read it, \`replace_text\`/\`insert_text\` to make one small edit at a time, and \`highlight\` to point at a passage while you talk about it. Make one small move, then hand the floor back.`;

type LogEntry = { kind: 'you' | 'partner' | 'tool' | 'system'; text: string };

/** Coerce an unknown event/arg field to a display string. */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export default function VoiceSpike() {
	const editorRef = useRef<MockEditor>(new MockEditor(SEED_PARAGRAPHS));
	const audioRef = useRef<HTMLAudioElement>(null);
	const sessionRef = useRef<RealtimeSession | null>(null);

	const [paragraphs, setParagraphs] = useState<string[]>(SEED_PARAGRAPHS);
	const [selection, setSelection] = useState('');
	const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>(
		'idle',
	);
	const [log, setLog] = useState<LogEntry[]>([]);

	const pushLog = useCallback((entry: LogEntry) => {
		setLog((prev) => [...prev, entry]);
	}, []);

	// Re-render whenever the document or selection changes.
	useEffect(() => {
		const editor = editorRef.current;
		const sync = () => {
			const snap = editor.snapshot();
			setParagraphs(snap.paragraphs);
			setSelection(snap.selection);
		};
		sync();
		return editor.subscribe(sync);
	}, []);

	const buildTools = useCallback((): RealtimeTool[] => {
		const editor = editorRef.current;
		return [
			{
				name: 'view',
				description: 'Read the current document text.',
				parameters: { type: 'object', properties: {}, required: [] },
				handler: async () => ({ document: await editor.getDocText() }),
			},
			{
				name: 'replace_text',
				description:
					'Replace a short span of existing text with new text. Both must be exact.',
				parameters: {
					type: 'object',
					properties: {
						old_str: { type: 'string' },
						new_str: { type: 'string' },
					},
					required: ['old_str', 'new_str'],
				},
				handler: async (a) => {
					await applyEditOp(editor, {
						kind: 'str_replace',
						oldStr: String(a.old_str),
						newStr: String(a.new_str),
					});
					pushLog({
						kind: 'tool',
						text: `replace_text("${str(a.old_str)}" → "${str(a.new_str)}")`,
					});
					return { ok: true };
				},
			},
			{
				name: 'insert_text',
				description:
					'Insert a new sentence or paragraph. Use `paragraph` (1-based) + `position` to place it relative to an existing paragraph.',
				parameters: {
					type: 'object',
					properties: {
						text: { type: 'string' },
						paragraph: { type: 'integer' },
						position: { type: 'string', enum: ['before', 'after'] },
					},
					required: ['text'],
				},
				handler: async (a) => {
					await applyEditOp(editor, {
						kind: 'insert',
						text: String(a.text),
						paragraph: a.paragraph as number | undefined,
						position: a.position as 'before' | 'after' | undefined,
					});
					pushLog({ kind: 'tool', text: `insert_text("${str(a.text)}")` });
					return { ok: true };
				},
			},
			{
				name: 'highlight',
				description: 'Select a passage to point at it while you talk about it.',
				parameters: {
					type: 'object',
					properties: { phrase: { type: 'string' } },
					required: ['phrase'],
				},
				handler: async (a) => {
					await editor.selectPhrase(String(a.phrase));
					pushLog({ kind: 'tool', text: `highlight("${str(a.phrase)}")` });
					return { ok: true };
				},
			},
		];
	}, [pushLog]);

	const start = useCallback(async () => {
		if (sessionRef.current || !audioRef.current) return;
		setStatus('connecting');
		setLog([]);
		try {
			const docText = await editorRef.current.getDocText();
			const session = await startRealtimeSession({
				audioEl: audioRef.current,
				instructions: `${INSTRUCTIONS_INTRO}\n\nThe document right now:\n"""\n${docText}\n"""`,
				tools: buildTools(),
				onEvent: (evt) => {
					// Surface transcripts and errors; ignore the firehose otherwise.
					// GA renamed the assistant transcript event with an `output_`
					// prefix; accept both so the log works across API versions.
					if (
						evt.type === 'response.audio_transcript.done' ||
						evt.type === 'response.output_audio_transcript.done'
					) {
						pushLog({ kind: 'partner', text: str(evt.transcript) });
					} else if (
						evt.type === 'conversation.item.input_audio_transcription.completed'
					) {
						pushLog({ kind: 'you', text: str(evt.transcript) });
					} else if (evt.type === 'error') {
						pushLog({
							kind: 'system',
							text: `error: ${JSON.stringify(evt.error ?? evt)}`,
						});
					}
				},
			});
			sessionRef.current = session;
			setStatus('live');
			pushLog({ kind: 'system', text: 'connected — start talking' });
		} catch (e) {
			setStatus('error');
			pushLog({ kind: 'system', text: `failed: ${(e as Error).message}` });
		}
	}, [buildTools, pushLog]);

	const stop = useCallback(() => {
		sessionRef.current?.stop();
		sessionRef.current = null;
		setStatus('idle');
		pushLog({ kind: 'system', text: 'stopped' });
	}, [pushLog]);

	useEffect(() => () => sessionRef.current?.stop(), []);

	return (
		<div style={S.page}>
			<audio ref={audioRef} autoPlay />
			<div style={S.header}>
				<strong>My Words — voice spike</strong>
				<span style={S.status(status)}>{status}</span>
				{status === 'live' ? (
					<button type="button" style={S.btn} onClick={stop}>
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

			<div style={S.body}>
				<div style={S.doc}>
					{paragraphs.map((p, i) => {
						const highlighted = selection && p.includes(selection);
						return (
							<p key={i} style={highlighted ? S.paraHi : S.para}>
								{p}
							</p>
						);
					})}
				</div>

				<div style={S.log}>
					{log.map((e, i) => (
						<div key={i} style={S.logRow(e.kind)}>
							<span style={S.logTag}>{e.kind}</span> {e.text}
						</div>
					))}
					{log.length === 0 && (
						<div style={S.logEmpty}>
							Click “Start talking”, grant mic access, and say something like
							“read my document, then add a sentence at the end.”
						</div>
					)}
				</div>
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
		gap: '0.75rem',
		padding: '0.6rem 1rem',
		borderBottom: '1px solid #e5e7eb',
	} as const,
	status: (s: string) =>
		({
			fontSize: '0.75rem',
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
	body: { flex: 1, display: 'flex', minHeight: 0 } as const,
	doc: {
		flex: '1 1 60%',
		padding: '1rem 1.25rem',
		overflowY: 'auto',
		lineHeight: 1.6,
		borderRight: '1px solid #e5e7eb',
	} as const,
	para: { margin: '0 0 0.75rem' } as const,
	paraHi: {
		margin: '0 0 0.75rem',
		background: '#fef08a',
		borderRadius: 3,
	} as const,
	log: {
		flex: '1 1 40%',
		padding: '0.75rem 1rem',
		overflowY: 'auto',
		fontSize: '0.8rem',
		background: '#f9fafb',
	} as const,
	logRow: (kind: string) =>
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
