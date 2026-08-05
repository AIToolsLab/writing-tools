/**
 * The shared model must be one `ai` speaks natively.
 *
 * `@ai-sdk/openai` and `ai` version their wire contract as a
 * `specificationVersion` on every model object. When the provider's is older
 * than what the installed `ai` implements, `ai` still runs the generation — it
 * wraps the model in a back-compat shim and logs
 *
 *   AI SDK Warning (openai.responses / <model>): The feature
 *   "specificationVersion" is used in a compatibility mode. …
 *
 * so a mismatch shows up only as console noise plus quietly unavailable
 * features. That is easy to reintroduce by bumping one package and not the
 * other, hence this test rather than a note in a changelog.
 *
 * `ai` only warns about the spec two behind its own; one behind it shims in
 * silence. So the second assertion pins the provider's spec to the mock class
 * `generate.test.ts` builds its fixtures from — if a provider bump makes those
 * disagree, the fixtures are describing a stream shape production no longer
 * sees, and both files need looking at together.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { GenerationError } from '../errors';
import { generateFullText } from '../generate';
import { languageModel, openaiProviderOptions } from '../openai';

type Warning = { type: string; feature?: string };

/** Responses-API SSE, the shape our proxy passes through from OpenAI. */
function responsesStream(text: string): string {
	const event = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`;
	return (
		event({
			type: 'response.created',
			response: { id: 'resp-test', created_at: 0, model: 'test-model' },
		}) +
		event({
			type: 'response.output_item.added',
			output_index: 0,
			item: { type: 'message', id: 'msg-test' },
		}) +
		event({
			type: 'response.output_text.delta',
			item_id: 'msg-test',
			delta: text,
		}) +
		event({
			type: 'response.completed',
			response: { usage: { input_tokens: 0, output_tokens: 0 } },
		}) +
		'data: [DONE]\n\n'
	);
}

/**
 * Collect what the SDK would otherwise print. `AI_SDK_LOG_WARNINGS` is the
 * documented hook for replacing the default logger.
 */
function captureWarnings(): Warning[] {
	const warnings: Warning[] = [];
	(globalThis as { AI_SDK_LOG_WARNINGS?: unknown }).AI_SDK_LOG_WARNINGS = ({
		warnings: batch,
	}: {
		warnings: Warning[];
	}) => {
		warnings.push(...batch);
	};
	return warnings;
}

afterEach(() => {
	delete (globalThis as { AI_SDK_LOG_WARNINGS?: unknown })
		.AI_SDK_LOG_WARNINGS;
	vi.unstubAllGlobals();
});

describe('the shared language model', () => {
	it('generates through the Responses API without a compatibility shim', async () => {
		const warnings = captureWarnings();
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					new Response(responsesStream('Hello from the model'), {
						status: 200,
						headers: {
							'content-type': 'text/event-stream; charset=utf-8',
						},
					}),
				),
			),
		);

		const text = await generateFullText({
			model: languageModel,
			prompt: 'hi',
			providerOptions: openaiProviderOptions,
		});

		expect(text).toBe('Hello from the model');
		expect(
			warnings.filter(
				(w) =>
					w.type === 'compatibility' ||
					w.feature === 'specificationVersion',
			),
		).toEqual([]);
	});

	it('still names the quota failure when the error precedes any output', async () => {
		// The provider turns a leading `error` event into a thrown APICallError
		// rather than a stream part, and 429 makes `ai` retry until it gives up
		// and wraps the lot in a RetryError. The writer must still be told it is
		// a billing problem, not "something went wrong, try again".
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(
					new Response(
						`data: ${JSON.stringify({
							type: 'error',
							sequence_number: 2,
							error: {
								type: 'insufficient_quota',
								code: 'insufficient_quota',
								message:
									'You exceeded your current quota, please check your plan and billing details.',
							},
						})}\n\ndata: [DONE]\n\n`,
						{
							status: 200,
							headers: {
								'content-type':
									'text/event-stream; charset=utf-8',
							},
						},
					),
				),
			),
		);

		const err = await generateFullText({
			model: languageModel,
			prompt: 'hi',
			// One retry rather than the default two: the point here is the
			// wrapping, and each attempt costs its backoff.
			maxRetries: 1,
		}).catch((e: unknown) => e);

		expect(err).toBeInstanceOf(GenerationError);
		const { info } = err as GenerationError;
		expect(info.code).toBe('insufficient_quota');
		expect(info.message).toMatch(/out of credit/i);
		expect(info.retryable).toBe(false);
	}, 20000);

	it('speaks the spec version the test fixtures are written against', () => {
		expect(languageModel.specificationVersion).toBe(
			new MockLanguageModelV4().specificationVersion,
		);
	});
});
