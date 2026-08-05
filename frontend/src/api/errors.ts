/**
 * Turning a failed generation into something the writer can read and act on.
 *
 * Model failures reach us in several unrelated shapes, and none of them is
 * presentable on its own:
 *
 * - A mid-stream provider error arrives as the raw SSE chunk the provider sent,
 *   e.g. `{ type: 'error', sequence_number: 2, error: { type, code, message } }`
 *   (see `@ai-sdk/openai`'s responses stream: it enqueues the whole chunk as the
 *   `error` part's payload). It is a plain object, not an `Error`.
 * - A non-2xx response from our proxy throws an `APICallError`, whose
 *   `responseBody` is the provider's JSON error envelope as text.
 * - An `error` event that arrives *before* any output does not become a stream
 *   part at all: the provider raises it as an `APICallError` carrying the
 *   status the error maps to, and `ai` retries anything that status marks
 *   retryable. When the attempts run out it throws a `RetryError` whose own
 *   message is "Failed after 3 attempts…" — the provider's error is inside, as
 *   `lastError`.
 * - Aborts and timeouts throw a `DOMException` named `AbortError`/`TimeoutError`.
 * - A dead network throws `TypeError: Failed to fetch`.
 *
 * {@link describeGenerationError} normalizes all of them into one
 * {@link GenerationErrorInfo}: a plain-language sentence for the writer, the raw
 * provider text kept aside for a details disclosure and the event log, and
 * whether retrying unchanged is worth offering.
 */
import { APICallError, RetryError } from 'ai';

export interface GenerationErrorInfo {
	/** One plain-language sentence for the writer, naming a next step. */
	message: string;
	/** Raw provider/transport text, for the details disclosure and event logs. */
	detail: string;
	/** Provider error code when one was reported (e.g. `insufficient_quota`). */
	code?: string;
	/** HTTP status when the failure came back as an HTTP response. */
	status?: number;
	/** Whether re-running the same request has a reasonable chance of working. */
	retryable: boolean;
}

/**
 * An `Error` carrying a {@link GenerationErrorInfo}. Thrown by the helpers in
 * `@/api/generate` so callers get a real `Error` (with a useful `message` and
 * the original failure as `cause`) no matter what the provider threw at us.
 */
export class GenerationError extends Error {
	readonly info: GenerationErrorInfo;
	/** The original thrown value or streamed error part. Assigned rather than
	 * passed to `super`: the build targets ES2020, which predates `cause`. */
	readonly cause: unknown;

	constructor(info: GenerationErrorInfo, cause?: unknown) {
		super(info.message);
		this.name = 'GenerationError';
		this.info = info;
		this.cause = cause;
	}
}

const GENERIC_MESSAGE =
	'Something went wrong while generating. Please try again.';

/** Per-code copy. Codes come from the provider's error envelope. */
const BY_CODE: Record<string, { message: string; retryable: boolean }> = {
	insufficient_quota: {
		message:
			'The AI account behind this add-in is out of credit, so nothing can be generated right now. This is not something you can fix from here — please let the team know so billing can be topped up.',
		retryable: false,
	},
	billing_hard_limit_reached: {
		message:
			'The AI account behind this add-in has hit its billing limit, so nothing can be generated right now. Please let the team know so billing can be raised.',
		retryable: false,
	},
	rate_limit_exceeded: {
		message:
			'The AI service is busy and rate-limited this request. Wait a few seconds and try again.',
		retryable: true,
	},
	invalid_api_key: {
		message:
			'The AI service rejected our credentials. Please let the team know — this needs fixing on the server.',
		retryable: false,
	},
	context_length_exceeded: {
		message:
			'This document is too long to send in one request. Try selecting a smaller part of it and running again.',
		retryable: false,
	},
	server_error: {
		message:
			'The AI service had an internal error. Please try again in a moment.',
		retryable: true,
	},
};

/** Fallback copy keyed by HTTP status when no code matched. */
function byStatus(
	status: number,
): { message: string; retryable: boolean } | null {
	if (status === 401)
		return {
			message:
				'Your session is not signed in to the AI service. Try signing in again, then re-run this.',
			retryable: false,
		};
	if (status === 403)
		return {
			message:
				'This account is not allowed to use the AI service. Please let the team know.',
			retryable: false,
		};
	if (status === 429) return BY_CODE.rate_limit_exceeded;
	if (status >= 500)
		return {
			message:
				'The AI service is temporarily unavailable. Please try again in a moment.',
			retryable: true,
		};
	return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseJson(text: unknown): unknown {
	if (typeof text !== 'string') return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Dig a `{ code, message }` pair out of a provider error envelope. Providers
 * nest the real error one or more levels deep (`{ error: { error: {...} } }`
 * happens when a proxy re-wraps), so recurse and let the innermost values win.
 */
function findProviderError(
	value: unknown,
	depth = 0,
): { code?: string; message?: string } {
	const record = asRecord(value);
	if (!record || depth > 4) return {};
	const nested = findProviderError(record.error, depth + 1);
	return {
		code: nested.code ?? asString(record.code),
		message: nested.message ?? asString(record.message),
	};
}

/** First candidate that yielded a code or a message; `{}` if none did. */
function firstProviderError(...candidates: unknown[]): {
	code?: string;
	message?: string;
} {
	for (const candidate of candidates) {
		const found = findProviderError(candidate);
		if (found.code !== undefined || found.message !== undefined)
			return found;
	}
	return {};
}

/**
 * The failure a {@link RetryError} was retrying, or null.
 *
 * The wrapper says only how many attempts were made, so describing it directly
 * costs us the provider's code and message — a quota failure comes out as the
 * generic "something went wrong", retryable, which is exactly the copy the
 * writer can't act on. `isInstance` is a marker check rather than
 * `instanceof`, but it still assumes the throwing `ai` is the one we imported;
 * fall back to the shape so a duplicated copy in the tree can't quietly
 * reintroduce the generic message.
 */
function retriedFailure(err: unknown): unknown {
	if (RetryError.isInstance(err)) return err.lastError ?? null;
	const record = asRecord(err);
	if (record?.name === 'AI_RetryError' && record.lastError != null)
		return record.lastError;
	return null;
}

/** True for aborts and timeouts, which need their own copy. */
function abortKind(err: unknown): 'timeout' | 'abort' | null {
	for (let cur: unknown = err, depth = 0; cur && depth < 4; depth++) {
		const name = asRecord(cur)?.name;
		if (name === 'TimeoutError') return 'timeout';
		if (name === 'AbortError') return 'abort';
		cur = asRecord(cur)?.cause;
	}
	return null;
}

/**
 * Normalize any thrown value (or streamed error part) into presentable form.
 * Never throws; unrecognized input degrades to a generic message plus whatever
 * text we could salvage as `detail`.
 */
export function describeGenerationError(err: unknown): GenerationErrorInfo {
	if (err instanceof GenerationError) return err.info;

	// Describe what actually failed, not the retry bookkeeping around it.
	const retried = retriedFailure(err);
	if (retried !== null) return describeGenerationError(retried);

	const aborted = abortKind(err);
	if (aborted !== null) {
		return {
			message:
				aborted === 'timeout'
					? 'That took too long and was stopped. Please try again.'
					: 'That request was cancelled.',
			detail: err instanceof Error ? err.message : String(err),
			retryable: true,
		};
	}

	// APICallError keeps the provider's JSON body as text; everything else we
	// read straight off the value we were handed.
	const isApiCallError = APICallError.isInstance(err);
	const status = isApiCallError ? err.statusCode : undefined;
	const provider = isApiCallError
		? firstProviderError(parseJson(err.responseBody), err.data)
		: firstProviderError(err);

	const detail =
		provider.message ??
		(isApiCallError ? (err.responseBody ?? err.message) : undefined) ??
		(err instanceof Error ? err.message : undefined) ??
		(typeof err === 'string' ? err : JSON.stringify(err) || String(err));

	const matched =
		(provider.code !== undefined ? BY_CODE[provider.code] : undefined) ??
		(status !== undefined ? byStatus(status) : null);

	if (matched) {
		return {
			message: matched.message,
			detail,
			code: provider.code,
			status,
			retryable: matched.retryable,
		};
	}

	// A failed `fetch` throws a bare TypeError with no status and no body.
	if (err instanceof TypeError) {
		return {
			message:
				'Could not reach the server. Check your connection and try again.',
			detail,
			retryable: true,
		};
	}

	return {
		message: GENERIC_MESSAGE,
		detail,
		code: provider.code,
		status,
		retryable: true,
	};
}
