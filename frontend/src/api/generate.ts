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
 * {@link streamParts} reads the full `stream` instead, so it sees the `error`
 * part and throws a {@link GenerationError} the moment one arrives. Pages should
 * use these helpers rather than calling `streamText` directly; a page that calls
 * `streamText` itself silently reintroduces the blank-panel bug.
 */
import {
	streamText,
	type ModelMessage,
	type TextStreamPart,
	type ToolSet,
} from 'ai';
import { describeGenerationError, GenerationError } from './errors';

type StreamTextOptions<TOOLS extends ToolSet = ToolSet> = Parameters<
	typeof streamText<TOOLS>
>[0];

/** Wrap whatever the stream (or the transport) failed with. */
function asGenerationError(raw: unknown): GenerationError {
	return raw instanceof GenerationError
		? raw
		: new GenerationError(describeGenerationError(raw), raw);
}

/**
 * Stream a generation, yielding every part as it arrives — text deltas, tool
 * calls and results, approval requests, step boundaries; never an `error`
 * part, which is thrown instead — and returning the response messages
 * (assistant and tool messages, across all steps) for the caller to keep as
 * transcript. For callers that only want text, see {@link streamTextDeltas}.
 *
 * Throws a {@link GenerationError} as soon as the model or transport fails —
 * including mid-stream, after parts have already been yielded, so a caller that
 * renders partial output keeps what arrived and can show the error alongside it.
 * Aborting via `abortSignal` ends the iteration; callers that abort on purpose
 * should check their own signal before treating a throw as a real failure.
 */
export async function* streamParts<TOOLS extends ToolSet = ToolSet>(
	options: StreamTextOptions<TOOLS>,
): AsyncGenerator<TextStreamPart<TOOLS>, ModelMessage[], void> {
	const result = streamText(options);
	// `stream`, not `textStream`: the latter drops `error` parts on the floor.
	// (`stream` is ai@7's name for what used to be `fullStream`, which is still
	// there as a deprecated alias.)
	for await (const part of result.stream) {
		if (part.type === 'error') {
			// Breaking out of the loop cancels the underlying stream.
			throw asGenerationError(part.error);
		}
		yield part;
	}
	return await result.responseMessages;
}

/**
 * Stream a generation, yielding text deltas as they arrive. Same error
 * behaviour as {@link streamParts}, which it filters.
 */
export async function* streamTextDeltas(
	options: StreamTextOptions,
): AsyncGenerator<string, void, void> {
	for await (const part of streamParts(options)) {
		if (part.type === 'text-delta') yield part.text;
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
