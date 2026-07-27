import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { describeGenerationError, GenerationError } from '../errors';

function apiCallError({
	statusCode,
	responseBody,
}: {
	statusCode: number;
	responseBody?: string;
}) {
	return new APICallError({
		message: 'request failed',
		url: 'https://example.test/openai/responses',
		requestBodyValues: {},
		statusCode,
		responseBody,
	});
}

describe('describeGenerationError', () => {
	it('reads a code out of a mid-stream provider chunk', () => {
		// The shape @ai-sdk/openai forwards for an `error` SSE event.
		const info = describeGenerationError({
			type: 'error',
			sequence_number: 2,
			error: {
				type: 'insufficient_quota',
				code: 'insufficient_quota',
				message: 'You exceeded your current quota.',
			},
		});

		expect(info.code).toBe('insufficient_quota');
		expect(info.message).toMatch(/out of credit/i);
		expect(info.detail).toBe('You exceeded your current quota.');
		expect(info.retryable).toBe(false);
	});

	it('reads a code out of an APICallError response body', () => {
		const info = describeGenerationError(
			apiCallError({
				statusCode: 429,
				responseBody: JSON.stringify({
					error: {
						code: 'rate_limit_exceeded',
						message: 'Slow down.',
					},
				}),
			}),
		);

		expect(info.code).toBe('rate_limit_exceeded');
		expect(info.status).toBe(429);
		expect(info.message).toMatch(/rate-limited/i);
		expect(info.retryable).toBe(true);
	});

	it('falls back to the HTTP status when no code is reported', () => {
		const info = describeGenerationError(
			apiCallError({ statusCode: 401, responseBody: 'Unauthorized' }),
		);

		expect(info.code).toBeUndefined();
		expect(info.status).toBe(401);
		expect(info.message).toMatch(/signed in/i);
		expect(info.retryable).toBe(false);

		const serverError = describeGenerationError(
			apiCallError({ statusCode: 503 }),
		);
		expect(serverError.message).toMatch(/temporarily unavailable/i);
		expect(serverError.retryable).toBe(true);
	});

	it('gives timeouts and aborts their own copy', () => {
		const timeout = new DOMException('signal timed out', 'TimeoutError');
		expect(describeGenerationError(timeout).message).toMatch(
			/took too long/i,
		);

		const abort = new DOMException('aborted', 'AbortError');
		expect(describeGenerationError(abort).message).toMatch(/cancelled/i);
	});

	it('names a dead network rather than blaming the model', () => {
		const info = describeGenerationError(new TypeError('Failed to fetch'));

		expect(info.message).toMatch(/could not reach the server/i);
		expect(info.retryable).toBe(true);
	});

	it('keeps the raw text as detail for anything it cannot classify', () => {
		const info = describeGenerationError(new Error('something odd'));

		expect(info.message).toMatch(/something went wrong/i);
		expect(info.detail).toBe('something odd');
		expect(info.retryable).toBe(true);
	});

	it('passes an already-described error straight through', () => {
		const original = describeGenerationError(
			new TypeError('Failed to fetch'),
		);
		expect(describeGenerationError(new GenerationError(original))).toEqual(
			original,
		);
	});
});
