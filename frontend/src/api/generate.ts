/**
 * The generation calls every page goes through.
 *
 * These exist because `streamText` from the AI SDK does not fail loudly. It
 * routes model and transport errors into the stream as an `error` part rather
 * than throwing, and `result.textStream` only forwards `text-delta` parts — so
 * an errored generation looks exactly like an empty successful one: the
 * `for await` loop ends normally, `await result.text` resolves to `''`, and any
 * surrounding `try/catch` never runs. That is how a quota failure reached the
 * writer as a blank panel.
 *
 * {@link streamTextDeltas} reads `fullStream` instead, so it sees the `error`
 * part and throws a {@link GenerationError} the moment one arrives. Pages should
 * use these helpers rather than calling `streamText` directly; a page that calls
 * `streamText` itself silently reintroduces the blank-panel bug.
 */
import { streamText } from 'ai';
import { describeGenerationError, GenerationError } from './errors';

type StreamTextOptions = Parameters<typeof streamText>[0];

/** Wrap whatever the stream (or the transport) failed with. */
function asGenerationError(raw: unknown): GenerationError {
	return raw instanceof GenerationError
		? raw
		: new GenerationError(describeGenerationError(raw), raw);
}

/**
 * Stream a generation, yielding text deltas as they arrive.
 *
 * Throws a {@link GenerationError} as soon as the model or transport fails —
 * including mid-stream, after deltas have already been yielded, so a caller that
 * renders partial text keeps what arrived and can show the error alongside it.
 * Aborting via `abortSignal` ends the iteration; callers that abort on purpose
 * should check their own signal before treating a throw as a real failure.
 */
export async function* streamTextDeltas(
	options: StreamTextOptions,
): AsyncGenerator<string, void, void> {
	const result = streamText(options);
	// `fullStream`, not `textStream`: the latter drops `error` parts on the floor.
	// (Still true in ai@7, which only renames `fullStream` to `stream` and keeps
	// the old name as a deprecated alias — switch this line when we upgrade.)
	for await (const part of result.fullStream) {
		if (part.type === 'text-delta') {
			yield part.text;
		} else if (part.type === 'error') {
			// Breaking out of the loop cancels the underlying stream.
			throw asGenerationError(part.error);
		}
	}
}

/**
 * Run a generation to completion and return the whole text. Same error
 * behaviour as {@link streamTextDeltas} — a failed generation throws instead of
 * resolving to an empty string.
 */
export async function generateFullText(
	options: StreamTextOptions,
): Promise<string> {
	let text = '';
	for await (const delta of streamTextDeltas(options)) {
		text += delta;
	}
	return text;
}
