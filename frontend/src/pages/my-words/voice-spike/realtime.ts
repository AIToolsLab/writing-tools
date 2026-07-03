/**
 * Minimal OpenAI Realtime (WebRTC) glue for the voice spike.
 *
 * The only thing that touches our backend is minting the ephemeral token
 * (`/api/openai/realtime/session`); the audio + event channels run browser →
 * OpenAI directly, authorised by that short-lived secret. Tools are plain
 * async handlers invoked when the model calls them; their JSON result is fed
 * back over the data channel. See docs/my-words-voice-native-research.md.
 *
 * This is a throwaway probe: enough error handling to fail loudly, no
 * reconnection, no session resumption.
 */

import { SERVER_URL } from '@/api';

/** A function the voice model may call. `parameters` is a JSON Schema object. */
export interface RealtimeTool {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => unknown;
}

export interface RealtimeSessionOptions {
	instructions: string;
	tools: RealtimeTool[];
	/** Element used to play the model's audio back. */
	audioEl: HTMLAudioElement;
	/** Optional firehose for logging/transcripts (raw server events). */
	onEvent?: (evt: Record<string, unknown>) => void;
	/** Model id; defaults to the realtime model the ephemeral token is bound to. */
	model?: string;
}

export interface RealtimeSession {
	stop: () => void;
}

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const DEFAULT_MODEL = 'gpt-realtime';

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

export async function startRealtimeSession(
	opts: RealtimeSessionOptions,
): Promise<RealtimeSession> {
	const model = opts.model ?? DEFAULT_MODEL;
	const ephemeralKey = await mintEphemeralKey();

	const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
	const pc = new RTCPeerConnection();

	// Remote audio (the model's voice) → the <audio> element.
	pc.ontrack = (e) => {
		opts.audioEl.srcObject = e.streams[0];
	};
	for (const track of mic.getTracks()) pc.addTrack(track, mic);

	const dc = pc.createDataChannel('oai-events');
	const send = (msg: Record<string, unknown>) => {
		if (dc.readyState === 'open') dc.send(JSON.stringify(msg));
	};

	dc.onopen = () => {
		// Configure the session once the channel is live: instructions (with the
		// document inlined by the caller), the tool schemas, and semantic
		// end-of-turn so pauses don't cut the writer off.
		send({
			type: 'session.update',
			session: {
				// GA Realtime requires `type` on the session, and moved all audio
				// config (turn detection, input transcription) under `audio`.
				type: 'realtime',
				instructions: opts.instructions,
				tools: opts.tools.map((t) => ({
					type: 'function',
					name: t.name,
					description: t.description,
					parameters: t.parameters,
				})),
				tool_choice: 'auto',
				audio: {
					input: {
						// Semantic end-of-turn so a thinking pause doesn't cut the writer off.
						turn_detection: { type: 'semantic_vad', "eagerness": "low" },
						// Transcribe the writer's speech so their turns show in the log.
						transcription: { model: 'gpt-realtime-whisper' },
						"noise_reduction": { "type": "far_field" },
					},
				},
			},
		});
		// Nudge the model to greet so there's immediate audio confirming the pipe.
		send({ type: 'response.create' });
	};

	const toolsByName = new Map(opts.tools.map((t) => [t.name, t]));

	dc.onmessage = async (e) => {
		let evt: Record<string, unknown>;
		try {
			evt = JSON.parse(e.data as string);
		} catch {
			return;
		}
		opts.onEvent?.(evt);

		// The model finished emitting a function call's arguments → run it.
		if (evt.type === 'response.function_call_arguments.done') {
			const name = evt.name as string;
			const callId = evt.call_id as string;
			const tool = toolsByName.get(name);
			let output: unknown;
			try {
				const args = evt.arguments
					? (JSON.parse(evt.arguments as string) as Record<string, unknown>)
					: {};
				output = tool
					? await tool.handler(args)
					: { error: `unknown tool ${name}` };
			} catch (err) {
				output = { error: (err as Error).message };
			}
			send({
				type: 'conversation.item.create',
				item: {
					type: 'function_call_output',
					call_id: callId,
					output: JSON.stringify(output),
				},
			});
			// Let the model speak/act on the tool result.
			send({ type: 'response.create' });
		}
	};

	// SDP handshake: our offer → OpenAI's answer, authorised by the ephemeral key.
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);

	const sdpRes = await fetch(`${REALTIME_CALLS_URL}?model=${encodeURIComponent(model)}`, {
		method: 'POST',
		body: offer.sdp,
		headers: {
			Authorization: `Bearer ${ephemeralKey}`,
			'Content-Type': 'application/sdp',
		},
	});
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
}
