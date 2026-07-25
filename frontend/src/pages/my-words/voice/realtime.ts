/**
 * OpenAI Realtime (WebRTC) implementation of the `VoiceTransport` seam.
 *
 * The only thing that touches our backend is minting the ephemeral token
 * (`/api/openai/realtime/session`); the audio + event channels run browser →
 * OpenAI directly, authorised by that short-lived secret. Tool calls arrive on
 * the data channel, are handed to the caller's handler, and the handler's string
 * goes back as the call's output.
 *
 * **This file is deliberately not unit-tested.** Every bug it has actually had
 * was an environment fact that a mock reproduces wrongly by construction: the
 * browser autoplay policy blocking a late `play()`, the GA schema moving audio
 * config under `session.audio`, the server rejecting a second concurrent
 * response, an error body being swallowed. A mock encodes our *assumption* about
 * those, which is the thing that was wrong each time. So this layer gets loud
 * errors, status callbacks, and manual verification; the logic worth testing
 * lives above it in `session.ts`.
 *
 * No reconnection and no session resumption: a dropped call surfaces as a status
 * and the writer presses Start again.
 */

import { SERVER_URL } from '@/api';

import type {
	TranscriptSegment,
	VoiceTool,
	VoiceTransport,
	VoiceTransportOptions,
	VoiceTransportSession,
} from './transport';

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const DEFAULT_MODEL = 'gpt-realtime-2';
const DEFAULT_VOICE = 'marin';

/** Mint an ephemeral client secret from our backend. */
async function mintEphemeralKey(): Promise<string> {
	const res = await fetch(`${SERVER_URL}/openai/realtime/session`, {
		method: 'POST',
	});
	const data = (await res.json().catch(() => ({}))) as {
		value?: string;
		client_secret?: { value?: string };
		detail?: string;
	};
	if (!res.ok) {
		throw new Error(data.detail || `Token mint failed (${res.status})`);
	}
	// GA `client_secrets` returns `{ value }`; the older `sessions` endpoint
	// nested it under `client_secret.value`. Accept either.
	const key = data.value ?? data.client_secret?.value;
	if (!key) throw new Error('No ephemeral key in token response');
	return key;
}

/** The `session.update` payload: prompt, tools, turn-taking, transcription. */
function sessionConfig(opts: VoiceTransportOptions, tools: VoiceTool[]) {
	return {
		// GA Realtime requires `type` on the session, and moved all audio config
		// (turn detection, input transcription) under `audio`.
		type: 'realtime',
		instructions: opts.instructions,
		tools: tools.map((t) => ({
			type: 'function',
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		})),
		tool_choice: 'auto',
		audio: {
			input: {
				// Semantic end-of-turn so a thinking pause doesn't cut the writer off.
				turn_detection: { type: 'semantic_vad', eagerness: 'low' },
				// Transcribe the writer's speech: this feeds the word bank, so it is
				// load-bearing for edits, not just for the on-screen log.
				transcription: { model: 'gpt-realtime-whisper' },
				noise_reduction: { type: 'far_field' },
			},
			output: { voice: opts.voice ?? DEFAULT_VOICE },
		},
	};
}

export const startRealtimeTransport: VoiceTransport = async (
	opts: VoiceTransportOptions,
): Promise<VoiceTransportSession> => {
	const model = opts.model ?? DEFAULT_MODEL;
	const ephemeralKey = await mintEphemeralKey();

	const mic = await navigator.mediaDevices.getUserMedia({ audio: true });

	// Prime playback *now*, while we're still in the gesture-activation window
	// that getUserMedia just confirmed: attach an empty stream to the <audio>
	// element and start it playing (silently). The model's track is added to this
	// same, already-playing stream in `ontrack`, so it becomes audible without a
	// second play() — sidestepping the autoplay block that otherwise eats a
	// play() fired later from ontrack. A rejected prime is the usual "no audio".
	const remoteStream = new MediaStream();
	opts.audioEl.srcObject = remoteStream;
	opts.audioEl.play().then(
		() => opts.onStatus?.('audio element primed'),
		(err: Error) =>
			opts.onStatus?.(
				`audio prime blocked: ${err.name} — ${err.message}`,
			),
	);

	const pc = new RTCPeerConnection();
	pc.ontrack = (e) => {
		opts.onStatus?.(`remote ${e.track.kind} track received`);
		remoteStream.addTrack(e.track);
	};
	pc.onconnectionstatechange = () =>
		opts.onStatus?.(`connection: ${pc.connectionState}`);
	for (const track of mic.getTracks()) pc.addTrack(track, mic);

	const dc = pc.createDataChannel('oai-events');
	const send = (msg: Record<string, unknown>) => {
		if (dc.readyState === 'open') dc.send(JSON.stringify(msg));
	};

	dc.onopen = () => {
		send({
			type: 'session.update',
			session: sessionConfig(opts, opts.tools),
		});
		// Nudge the model to greet so there's immediate audio confirming the pipe.
		send(
			opts.greeting
				? {
						type: 'response.create',
						response: { instructions: opts.greeting },
					}
				: { type: 'response.create' },
		);
	};

	const toolsByName = new Map(opts.tools.map((t) => [t.name, t]));

	// The API allows only one active response at a time. The model can emit
	// several tool calls within one response, so we can't fire `response.create`
	// per call — that collides with the still-running response. Track the active
	// response and defer a single follow-up until it finishes.
	let activeResponse = false;
	let wantFollowUp = false;
	const requestResponse = () => {
		if (activeResponse) wantFollowUp = true;
		else send({ type: 'response.create' });
	};

	// Transcript text accumulated per item, so interim updates can be emitted as
	// deltas arrive and then replaced in place when the item settles. Consumers
	// key on the item id, so one utterance stays one line.
	const partials = new Map<string, string>();
	/** Read a string field off an event; anything else reads as absent. */
	const field = (evt: Record<string, unknown>, key: string): string =>
		typeof evt[key] === 'string' ? evt[key] : '';
	const emit = (
		who: TranscriptSegment['who'],
		evt: Record<string, unknown>,
		final: boolean,
	) => {
		const id = field(evt, 'item_id');
		if (!id) return;
		let text: string;
		if (final) {
			// Prefer the authoritative transcript; fall back to what we accumulated.
			text = field(evt, 'transcript') || (partials.get(id) ?? '');
			partials.delete(id);
		} else {
			text = (partials.get(id) ?? '') + field(evt, 'delta');
			partials.set(id, text);
		}
		const trimmed = text.trim();
		if (trimmed) opts.onTranscript?.({ who, id, text: trimmed, final });
	};

	dc.onmessage = async (e) => {
		let evt: Record<string, unknown>;
		try {
			evt = JSON.parse(e.data as string);
		} catch {
			return;
		}

		switch (evt.type) {
			case 'response.created':
				activeResponse = true;
				return;
			case 'response.done':
				activeResponse = false;
				if (wantFollowUp) {
					wantFollowUp = false;
					send({ type: 'response.create' });
				}
				return;
			// The writer took the floor. This must fire as early as the VAD can tell,
			// because a veto window is only ~750ms wide (see session.ts invariants).
			case 'input_audio_buffer.speech_started':
				opts.onSpeechStart?.();
				return;
			case 'conversation.item.input_audio_transcription.delta':
				emit('you', evt, false);
				return;
			case 'conversation.item.input_audio_transcription.completed':
				emit('you', evt, true);
				return;
			case 'response.output_audio_transcript.delta':
				emit('partner', evt, false);
				return;
			case 'response.output_audio_transcript.done':
				emit('partner', evt, true);
				return;
			case 'error':
				opts.onStatus?.(`error: ${JSON.stringify(evt.error ?? evt)}`);
				return;
		}

		// The model finished emitting a function call's arguments → run it.
		if (evt.type === 'response.function_call_arguments.done') {
			const name = evt.name as string;
			const callId = evt.call_id as string;
			const tool = toolsByName.get(name);
			let output: string;
			try {
				const args = evt.arguments
					? (JSON.parse(evt.arguments as string) as Record<
							string,
							unknown
						>)
					: {};
				output = tool
					? await tool.handler(args)
					: `There is no tool called ${name}.`;
			} catch (err) {
				// Handlers are written not to throw; if one does anyway, tell the model
				// rather than dropping the call, which would leave it waiting forever.
				output = `That tool call failed: ${(err as Error).message}`;
			}
			send({
				type: 'conversation.item.create',
				item: {
					type: 'function_call_output',
					call_id: callId,
					output,
				},
			});
			// Let the model speak/act on the tool result — but only once the
			// response that made the call(s) has finished (see requestResponse).
			requestResponse();
		}
	};

	// SDP handshake: our offer → OpenAI's answer, authorised by the ephemeral key.
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);

	const sdpRes = await fetch(
		`${REALTIME_CALLS_URL}?model=${encodeURIComponent(model)}`,
		{
			method: 'POST',
			body: offer.sdp,
			headers: {
				Authorization: `Bearer ${ephemeralKey}`,
				'Content-Type': 'application/sdp',
			},
		},
	);
	if (!sdpRes.ok) {
		const detail = await sdpRes.text().catch(() => '');
		mic.getTracks().forEach((t) => t.stop());
		pc.close();
		throw new Error(
			`SDP exchange failed (${sdpRes.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
		);
	}
	const answerSdp = await sdpRes.text();
	await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

	return {
		stop: () => {
			try {
				dc.close();
			} catch {
				/* already closed */
			}
			mic.getTracks().forEach((t) => t.stop());
			pc.close();
		},
	};
};
