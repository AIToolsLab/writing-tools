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
 * Tool results are returned to the agent as plain strings (the model reads
 * them): a numbered `view`, an "Applied …" confirmation, or a `REJECTED: …`
 * line when the words aren't the writer's — the same re-orient contract the
 * text path's `walkthrough` strategy uses.
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
import { applyEditOp } from '../interaction/editor';
import { validateOp, viewText } from '../interaction/shared';
import type { EditOp } from '../interaction/types';

export type TranscriptSpeaker = 'you' | 'partner';

export interface VoiceSessionOptions {
	/** The real editor host (from EditorContext). */
	editor: EditorAPI;
	/** Builds the live word-bank; must include the writer's rolling transcript. */
	corpus: () => Promise<Corpus>;
	/** Element the agent's audio track is attached to for playback. */
	audioEl: HTMLAudioElement;
	/** A finalized transcript segment (writer or agent). */
	onTranscript?: (who: TranscriptSpeaker, text: string) => void;
	/** A tool call landed (for the on-screen log). */
	onTool?: (text: string) => void;
	/** Connection/playback status (not conversation content). */
	onStatus?: (text: string) => void;
}

export interface VoiceSession {
	stop: () => Promise<void>;
}

const TOOL_NAMES = ['view', 'str_replace', 'insert', 'move', 'highlight'] as const;

/** Map an RPC payload to an `EditOp`, or throw if the shape is unusable. */
function payloadToOp(method: string, a: Record<string, unknown>): EditOp {
	switch (method) {
		case 'str_replace':
			return {
				kind: 'str_replace',
				oldStr: String(a.old_str ?? ''),
				newStr: String(a.new_str ?? ''),
				paragraph: a.paragraph as number | undefined,
			};
		case 'insert':
			return {
				kind: 'insert',
				text: String(a.text ?? ''),
				after: a.after as string | undefined,
				paragraph: a.paragraph as number | undefined,
				position: a.position as 'before' | 'after' | undefined,
			};
		case 'move':
			return {
				kind: 'move',
				phrase: String(a.phrase ?? ''),
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
	const { editor, corpus, audioEl } = opts;

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

	// Transcriptions arrive as text streams on the `lk.transcription` topic, one
	// per finalized segment, tagged with the speaker's identity.
	room.registerTextStreamHandler(
		'lk.transcription',
		async (reader, participant: { identity?: string }) => {
			const text = (await reader.readAll()).trim();
			if (!text) return;
			const who: TranscriptSpeaker =
				participant.identity === room.localParticipant.identity
					? 'you'
					: 'partner';
			opts.onTranscript?.(who, text);
		},
	);

	// The tool handler the agent's forwarded RPCs land on. Returns a string the
	// model reads; never throws for a word-bank miss (that's a normal REJECTED
	// result the model should re-orient on), only for genuinely broken calls.
	const handleTool = (method: string) => async (rpc: RpcInvocationData) => {
		let args: Record<string, unknown> = {};
		try {
			args = rpc.payload ? (JSON.parse(rpc.payload) as Record<string, unknown>) : {};
		} catch {
			return 'That tool call had a malformed payload.';
		}

		if (method === 'view') {
			return viewText(editor);
		}
		if (method === 'highlight') {
			const phrase = String(args.phrase ?? '');
			try {
				await editor.selectPhrase(phrase);
				opts.onTool?.(`highlight("${phrase}")`);
				return 'Highlighted.';
			} catch {
				return `Could not find "${phrase}" to highlight.`;
			}
		}

		// An edit: validate against the writer's words, then apply.
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

		try {
			await applyEditOp(editor, op);
		} catch (e) {
			return `Could not apply that: ${(e as Error).message} Re-\`view\` and check the paragraph numbers, then try again.`;
		}
		opts.onTool?.(`${method} applied`);
		// Hand back the current numbered document so the model tracks any shifts.
		return `Applied. The document now reads:\n${await viewText(editor)}`;
	};

	// 2. Connect, then register RPC methods + publish the mic.
	await room.connect(data.url, data.token);
	for (const name of TOOL_NAMES) {
		room.localParticipant.registerRpcMethod(name, handleTool(name));
	}
	await room.localParticipant.setMicrophoneEnabled(true);
	// Resume the audio context now, while the start-button gesture is still live.
	await room.startAudio().catch(() => opts.onStatus?.('click again to enable audio'));
	opts.onStatus?.('connected — start talking');

	return {
		stop: async () => {
			await room.disconnect();
		},
	};
}
