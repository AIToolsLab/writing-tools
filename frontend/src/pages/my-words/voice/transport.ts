/**
 * The seam between the My Words voice session and whatever carries the spoken
 * conversation.
 *
 * Everything above this line — the six editor tools, the word-bank rule, the
 * reveal/veto beat, the undo stack (see `session.ts`) — is transport-agnostic.
 * Everything below it is audio plumbing and one vendor's event vocabulary
 * (`realtime.ts`, OpenAI Realtime over WebRTC).
 *
 * The seam exists so a second speech-to-speech engine (Gemini Live, say) is a
 * new implementation of `VoiceTransport` rather than a rewrite of the session.
 * It deliberately does NOT abstract a cascaded STT→LLM→TTS pipeline: that needs
 * a server process holding the turn loop, and no browser-side interface buys
 * you that. See docs/my-words-voice-native-research.md.
 *
 * Two of the callbacks below are load-bearing for the *control* mechanics, not
 * just for display, so an implementation must supply them:
 *
 * - `onSpeechStart` — the writer taking the floor. It cancels a pending edit's
 *   veto window and grants the next move (see the invariants in `session.ts`).
 * - `onTranscript` — the writer's own words, which feed the word bank. Without
 *   it the model is rejected for shaping words the writer just said aloud.
 */

/** A tool the voice model may call. `parameters` is a JSON Schema object. */
export interface VoiceTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	/** Returns the string the model reads back. Should not throw. */
	handler: (args: Record<string, unknown>) => Promise<string> | string;
}

export type TranscriptSpeaker = 'you' | 'partner';

/**
 * One transcription update. An utterance streams as a growing interim text and
 * then settles (`final: true`), all updates sharing `id` — so consumers replace
 * by `id` rather than appending a line per update.
 */
export interface TranscriptSegment {
	who: TranscriptSpeaker;
	/** Stable across this utterance's interim and final updates. */
	id: string;
	text: string;
	final: boolean;
}

export interface VoiceTransportOptions {
	/** System prompt, with anything the model needs inlined by the caller. */
	instructions: string;
	/**
	 * Instructions for one opening spoken turn, so the writer hears that the pipe
	 * is live. Omit to let the model open however the prompt suggests.
	 */
	greeting?: string;
	tools: VoiceTool[];
	/** Element the model's audio is played back through. */
	audioEl: HTMLAudioElement;
	/** A transcript update (interim or final); dedupe by `seg.id`. */
	onTranscript?: (seg: TranscriptSegment) => void;
	/** Connection/playback status — never conversation content. */
	onStatus?: (msg: string) => void;
	/**
	 * The writer began speaking. Must fire as early as the engine can tell,
	 * because a veto window is only ~750ms wide.
	 */
	onSpeechStart?: () => void;
	/** Model id; defaults to the transport's own current default. */
	model?: string;
	/** Voice name for the model's speech. */
	voice?: string;
}

export interface VoiceTransportSession {
	stop: () => Promise<void> | void;
}

/** Start a live voice conversation. Rejects if the connection can't be made. */
export type VoiceTransport = (
	opts: VoiceTransportOptions,
) => Promise<VoiceTransportSession>;
