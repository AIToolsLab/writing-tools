/**
 * LiveKit session glue for the My Words voice tab.
 *
 * The browser holds the room connection, publishes the mic, and plays the
 * agent's audio. The agent (voice-agent/, a Python worker) runs the Realtime
 * model and forwards each tool call here over RPC; we register a handler per
 * tool that maps the payload to an `EditOp`, enforces the word-bank rule
 * (`validateOp`) against the *live* corpus, and applies it through the real
 * `EditorAPI`. So voice reuses the same durable edit path as the text tabs —
 * only the turn-loop is different. See docs/my-words-voice-native-research.md.
 *
 * Every tool takes `target: 'document' | 'scratchpad'`. The scratchpad is a
 * second, deliberately-out-of-sync surface (the writer's ideas in their own
 * words, Markdown-ish); edits to it run through the same validation and the
 * same paragraph-splice machinery, applied to the text held by the React page.
 *
 * Edits land reveal-first (highlight → beat → apply, cancellable via the ✕
 * chip) and each successful edit pushes its inverse splices onto a session
 * undo stack the `undo` tool (and the UI button) pops — freshness-checked, so
 * a hand-edited region is never clobbered.
 *
 * Tool results are returned to the agent as plain strings (the model reads
 * them): a numbered `view`, a windowed "Applied …" confirmation, or a
 * `REJECTED: …` line when the words aren't the writer's — the same re-orient
 * contract the text path's `walkthrough` strategy uses.
 */

import {
	Room,
	RoomEvent,
	Track,
	type RemoteTrack,
	type RpcInvocationData,
} from 'livekit-client';

import { SERVER_URL } from '@/api';

import type { Corpus } from '../corpus';
import {
	applyEditOp,
	applySpliceToEditor,
	delay,
	EditVetoed,
	revealAnchorFor,
	vetoWindow,
	type ApplyEditOptions,
} from '../interaction/editor';
import {
	applyOpLogged,
	applySplice,
	describeOp,
	invertSplices,
	spliceIsFresh,
} from '../interaction/ops';
import {
	appliedReport,
	numberedWindow,
	validateOp,
	viewParagraphs,
} from '../interaction/shared';
import type { EditOp } from '../interaction/types';

export type TranscriptSpeaker = 'you' | 'partner';

/**
 * One transcription update. LiveKit splits each utterance into a segment and
 * emits an interim stream (`final: false`, live updates) then a final stream
 * (`final: true`), both sharing `id` — so consumers replace by `id` rather than
 * appending, and act on the writer's words only when `final`.
 */
export interface TranscriptSegment {
	who: TranscriptSpeaker;
	/** Stable `lk.segment_id`: interim and final updates share it. */
	id: string;
	text: string;
	final: boolean;
}

type Target = 'document' | 'scratchpad';

export interface VoiceSessionOptions {
	/** The real editor host (from EditorContext). */
	editor: EditorAPI;
	/** Builds the live word-bank; must include the writer's rolling transcript. */
	corpus: () => Promise<Corpus>;
	/**
	 * Read/write access to the scratchpad text. `set` must update synchronously
	 * (ref first, then React state) so back-to-back tool calls see fresh text.
	 */
	scratchpad: { get: () => string; set: (text: string) => void };
	/** Element the agent's audio track is attached to for playback. */
	audioEl: HTMLAudioElement;
	/** A transcript update (interim or final); dedupe by `seg.id`. */
	onTranscript?: (seg: TranscriptSegment) => void;
	/** A tool call landed (for the on-screen log). */
	onTool?: (text: string) => void;
	/** Connection/playback status (not conversation content). */
	onStatus?: (text: string) => void;
	/** The agent points at a scratchpad phrase (null clears the highlight). */
	onScratchpadHighlight?: (phrase: string | null) => void;
	/** A veto window opened (info) or closed (null); wire `cancel` to a ✕ chip. */
	onReveal?: (info: { anchor?: string; cancel: () => void } | null) => void;
	/** The undo stack's depth changed (enables/disables the Undo button). */
	onUndoDepth?: (depth: number) => void;
}

export interface VoiceSession {
	stop: () => Promise<void>;
	/** Undo the most recent agent edit (shared by the UI button and the tool). */
	undo: () => Promise<string>;
}

const TOOL_NAMES = [
	'view',
	'str_replace',
	'insert',
	'move',
	'highlight',
	'undo',
] as const;

/** How many agent edits stay undoable. */
const UNDO_CAP = 10;

/** Beat before a scratchpad edit lands (the panel highlight is the reveal). */
const SCRATCHPAD_REVEAL_MS = 750;

/** Coerce an unknown RPC-payload field to a string (non-strings → ''). */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Map an RPC payload to an `EditOp`, or throw if the shape is unusable. */
function payloadToOp(method: string, a: Record<string, unknown>): EditOp {
	switch (method) {
		case 'str_replace':
			return {
				kind: 'str_replace',
				oldStr: str(a.old_str),
				newStr: str(a.new_str),
				paragraph: a.paragraph as number | undefined,
			};
		case 'insert':
			return {
				kind: 'insert',
				text: str(a.text),
				after: a.after as string | undefined,
				paragraph: a.paragraph as number | undefined,
				position: a.position as 'before' | 'after' | undefined,
			};
		case 'move':
			return {
				kind: 'move',
				phrase: str(a.phrase),
				paragraph: Number(a.paragraph),
				position: a.position as 'before' | 'after' | undefined,
			};
		default:
			throw new Error(`not an edit tool: ${method}`);
	}
}

export async function startVoiceSession(
	opts: VoiceSessionOptions,
): Promise<VoiceSession> {
	const { editor, corpus, audioEl, scratchpad } = opts;

	// 1. Mint a room-join token from our backend (server key stays there).
	const res = await fetch(`${SERVER_URL}/livekit/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({}),
	});
	const data = (await res.json().catch(() => ({}))) as {
		token?: string;
		url?: string;
		detail?: string;
	};
	if (!res.ok || !data.token || !data.url) {
		throw new Error(data.detail || `Token request failed (${res.status})`);
	}

	const room = new Room();

	// Play the agent's audio track when it arrives.
	room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
		if (track.kind === Track.Kind.Audio) {
			track.attach(audioEl);
			opts.onStatus?.('agent audio connected');
		}
	});
	room.on(RoomEvent.Disconnected, () => opts.onStatus?.('disconnected'));

	// Transcriptions arrive as text streams on the `lk.transcription` topic. Each
	// utterance yields an interim then a final stream sharing `lk.segment_id`; we
	// pass both up (tagged `final`) so consumers replace-by-id instead of piling
	// up a line per update. (The handler must return void, so the async read runs
	// in a fire-and-forget IIFE.)
	room.registerTextStreamHandler(
		'lk.transcription',
		(reader, participant: { identity?: string }) => {
			const attrs = reader.info.attributes ?? {};
			// Real transcriptions carry a transcribed track id; ignore other text.
			if (!attrs['lk.transcribed_track_id']) return;
			void (async () => {
				const text = (await reader.readAll()).trim();
				if (!text) return;
				opts.onTranscript?.({
					who:
						participant.identity === room.localParticipant.identity
							? 'you'
							: 'partner',
					id: attrs['lk.segment_id'] || reader.info.id,
					text,
					final: attrs['lk.transcription_final'] === 'true',
				});
			})();
		},
	);

	const scratchLines = () => scratchpad.get().split('\n');

	// Inverses of applied edits, most recent last. Popped by `undo`; each entry
	// is freshness-checked against the live surface before it restores anything.
	const undoStack: {
		target: Target;
		splices: ParagraphSplice[];
		description: string;
	}[] = [];
	const pushUndo = (entry: (typeof undoStack)[number]) => {
		undoStack.push(entry);
		if (undoStack.length > UNDO_CAP) undoStack.shift();
		opts.onUndoDepth?.(undoStack.length);
	};

	const undoLast = async (): Promise<string> => {
		const entry = undoStack.pop();
		opts.onUndoDepth?.(undoStack.length);
		if (!entry) return 'Nothing to undo.';
		const { target, splices, description } = entry;

		// Dry-run against the live surface: every splice must still find the
		// text it expects (the writer may have typed, or hit the host's own
		// undo, since the edit landed).
		let paras =
			target === 'document' ? await editor.getParagraphs() : scratchLines();
		for (const s of splices) {
			if (!spliceIsFresh(paras, s)) {
				opts.onTool?.(`undo skipped (stale): ${description}`);
				return `That edit has already been changed — nothing was undone.`;
			}
			paras = applySplice(paras, s);
		}

		// Reveal where the revert happens, then apply for real.
		const anchor = splices[0]?.remove[0];
		if (target === 'document') {
			if (anchor) await editor.selectPhrase(anchor).catch(() => {});
			await delay(SCRATCHPAD_REVEAL_MS);
			for (const s of splices) await applySpliceToEditor(editor, s);
		} else {
			if (anchor) opts.onScratchpadHighlight?.(anchor);
			await delay(SCRATCHPAD_REVEAL_MS);
			scratchpad.set(paras.join('\n'));
			opts.onScratchpadHighlight?.(null);
		}
		opts.onTool?.(`undo: ${description}`);
		const around = (splices[splices.length - 1]?.index ?? 0) + 1;
		return `Undid: ${description}. The ${target} now has ${paras.length} paragraph(s). Around the change:\n${numberedWindow(paras, around)}`;
	};

	// The tool handler the agent's forwarded RPCs land on. Returns a string the
	// model reads; never throws for a word-bank miss (that's a normal REJECTED
	// result the model should re-orient on), only for genuinely broken calls.
	const handleTool = (method: string) => async (rpc: RpcInvocationData) => {
		let args: Record<string, unknown> = {};
		try {
			args = rpc.payload
				? (JSON.parse(rpc.payload) as Record<string, unknown>)
				: {};
		} catch {
			return 'That tool call had a malformed payload.';
		}
		const target: Target =
			args.target === 'scratchpad' ? 'scratchpad' : 'document';

		if (method === 'undo') {
			return undoLast();
		}

		if (method === 'view') {
			const paras =
				target === 'document' ? await editor.getParagraphs() : scratchLines();
			const around = typeof args.around === 'number' ? args.around : undefined;
			if (around !== undefined) return numberedWindow(paras, around, 2);
			return viewParagraphs(
				paras,
				target === 'document'
					? '(the document is empty)'
					: '(the scratchpad is empty)',
			);
		}

		if (method === 'highlight') {
			const phrase = str(args.phrase);
			if (target === 'scratchpad') {
				if (!scratchpad.get().includes(phrase)) {
					return `Could not find "${phrase}" on the scratchpad.`;
				}
				opts.onScratchpadHighlight?.(phrase);
				opts.onTool?.(`highlight scratchpad ("${phrase}")`);
				return 'Highlighted on the scratchpad.';
			}
			try {
				await editor.selectPhrase(phrase);
				opts.onTool?.(`highlight("${phrase}")`);
				return 'Highlighted.';
			} catch {
				return `Could not find "${phrase}" to highlight.`;
			}
		}

		// An edit: validate against the writer's words, then reveal-and-apply.
		let op: EditOp;
		try {
			op = payloadToOp(method, args);
		} catch (e) {
			return `Could not read that tool call: ${(e as Error).message}`;
		}

		const check = validateOp(op, await corpus());
		if (!check.ok) {
			opts.onTool?.(`REJECTED ${method}: "${check.offending}"`);
			return `REJECTED: "${check.offending}" isn't in the writer's words yet. Use only what they've written or said aloud.`;
		}

		const revealOpts: Pick<ApplyEditOptions, 'onReveal' | 'onRevealEnd'> = {
			onReveal: (info) => opts.onReveal?.(info),
			onRevealEnd: () => opts.onReveal?.(null),
		};

		if (target === 'scratchpad') {
			const before = scratchLines();
			try {
				// Reveal in the panel, run the veto window, then splice the text.
				const anchor = revealAnchorFor(op, before);
				if (anchor && scratchpad.get().includes(anchor)) {
					opts.onScratchpadHighlight?.(anchor);
				}
				const vetoed = await vetoWindow(
					SCRATCHPAD_REVEAL_MS,
					revealOpts,
					anchor,
				);
				if (vetoed) throw new EditVetoed();
				const { after, undo } = applyOpLogged(before, op);
				scratchpad.set(after.join('\n'));
				pushUndo({
					target: 'scratchpad',
					splices: undo,
					description: describeOp(op),
				});
				opts.onTool?.(`${method} applied to scratchpad`);
				return appliedReport(after, op, 'scratchpad');
			} catch (e) {
				if (e instanceof EditVetoed) {
					opts.onTool?.(`${method} vetoed by the writer`);
					return `The writer cancelled that edit during the reveal. Don't retry it — ask how they'd like to proceed.`;
				}
				return `Could not apply that to the scratchpad: ${(e as Error).message} Re-\`view\` the scratchpad and try again.`;
			} finally {
				opts.onScratchpadHighlight?.(null);
			}
		}

		try {
			const splices = await applyEditOp(editor, op, revealOpts);
			pushUndo({
				target: 'document',
				splices: invertSplices(splices),
				description: describeOp(op),
			});
		} catch (e) {
			if (e instanceof EditVetoed) {
				opts.onTool?.(`${method} vetoed by the writer`);
				return `The writer cancelled that edit during the reveal. Don't retry it — ask how they'd like to proceed.`;
			}
			return `Could not apply that: ${(e as Error).message} Re-\`view\` and check the paragraph numbers, then try again.`;
		}
		opts.onTool?.(`${method} applied`);
		// Hand back a window around the change so the model tracks any shifts.
		return appliedReport(await editor.getParagraphs(), op);
	};

	// 2. Connect, then register RPC methods + publish the mic.
	await room.connect(data.url, data.token);
	for (const name of TOOL_NAMES) {
		room.localParticipant.registerRpcMethod(name, handleTool(name));
	}
	await room.localParticipant.setMicrophoneEnabled(true);
	// Resume the audio context now, while the start-button gesture is still live.
	await room
		.startAudio()
		.catch(() => opts.onStatus?.('click again to enable audio'));
	opts.onStatus?.('connected — start talking');

	return {
		stop: async () => {
			await room.disconnect();
		},
		undo: undoLast,
	};
}
