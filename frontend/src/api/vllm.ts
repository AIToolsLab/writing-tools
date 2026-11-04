/**
 * Thin client for a stock vLLM server's raw API: the OpenAI-compatible
 * `/v1/completions` plus vLLM's own `/tokenize` and `/detokenize`.
 *
 * Ported from AIToolsLab/writing-prototypes (`docs/llm.js`). It exists because
 * the token-level Workbench needs things the OpenAI proxy can't give it:
 * `prompt_logprobs`, raw text completions on a hand-rendered chat prefix, and
 * regex-constrained output. It talks to the server directly from the browser —
 * no token, CORS open — so these requests bypass the backend: no auth, no
 * consent stripping, no `llm_usage` metering. Every request reports its
 * duration through `onTiming` so the page can log response times; if those get
 * untenable, that's when we start thinking about limits (and a proxy).
 *
 * The response text is never passed through the chat template, because Jinja
 * trims its whitespace. We render the chat prefix once (`/tokenize` with
 * `add_generation_prompt`, then `/detokenize`), cache it, and send
 * `prefix + response` as a text prompt. vLLM parses the special-token strings
 * in it, giving the same token ids as tokenizing the two parts separately.
 */

export const VLLM_URL: string =
	import.meta.env.VITE_VLLM_URL || 'https://vllm.thoughtful-ai.com';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

/** Called after every request, successful or not. */
export type TimingFn = (timing: {
	path: string;
	ms: number;
	ok: boolean;
}) => void;

export type PostFn = <T>(
	path: string,
	body: unknown,
	signal?: AbortSignal,
) => Promise<T>;

/** One entry of a prompt/next-token distribution, as vLLM reports it. */
export interface TokenLogprob {
	logprob: number;
	rank: number | null;
	decoded_token: string;
}

export interface CompletionChoice {
	index: number;
	text: string;
	prompt_token_ids?: number[];
	/** Per prompt position, keyed by token id; the first entry is null. */
	prompt_logprobs?: (Record<string, TokenLogprob> | null)[];
	logprobs?: {
		tokens: string[];
		token_logprobs: number[];
		top_logprobs: Record<string, number>[];
	};
}

export interface CompletionResponse {
	choices: CompletionChoice[];
}

// Thinking off: we want the model's direct response, and the thinking-disabled
// generation prompt ends in "<think>\n\n</think>\n\n" with no surprises after it.
const CHAT_TEMPLATE_KWARGS = { enable_thinking: false };

const PLACEHOLDER = 'XYZZYPLACEHOLDER';

export interface ChatPrefix {
	/** Token ids of the prefix. Only available for assistant turns. */
	ids?: number[];
	text: string;
}

export class VllmClient {
	private model: Promise<string> | null = null;
	/** A few recent prefix renders, keyed by their inputs. */
	private cache = new Map<string, Promise<unknown>>();

	constructor(
		private readonly post: PostFn,
		private readonly maxCached = 8,
	) {}

	/** The server's first listed model — what writing-prototypes uses too. */
	loadModel(): Promise<string> {
		if (!this.model) {
			const pending = this.post<{ data: { id: string }[] }>(
				'/v1/models',
				undefined,
			).then((res) => res.data[0].id);
			pending.catch(() => {
				if (this.model === pending) this.model = null;
			});
			this.model = pending;
		}
		return this.model;
	}

	private cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
		let hit = this.cache.get(key) as Promise<T> | undefined;
		if (!hit) {
			hit = fn();
			const promise = hit;
			// Failed results are dropped so the next call retries.
			promise.catch(() => {
				if (this.cache.get(key) === promise) this.cache.delete(key);
			});
			this.cache.set(key, promise);
			if (this.cache.size > this.maxCached) {
				const oldest = this.cache.keys().next().value;
				if (oldest !== undefined) this.cache.delete(oldest);
			}
		}
		return hit;
	}

	/**
	 * The chat-templated prompt for a message from `role` after `history`. For an
	 * assistant turn that's the generation prompt (with token ids); a user turn
	 * has none, so render it with a placeholder as its content and cut there.
	 */
	turnPrefix(
		history: ChatMessage[],
		role: ChatMessage['role'],
	): Promise<ChatPrefix> {
		return this.cached(JSON.stringify([role, history]), async () => {
			const model = await this.loadModel();
			const assistant = role === 'assistant';
			const { tokens } = await this.post<{ tokens: number[] }>(
				'/tokenize',
				{
					model,
					messages: assistant
						? history
						: [...history, { role, content: PLACEHOLDER }],
					add_generation_prompt: assistant,
					chat_template_kwargs: CHAT_TEMPLATE_KWARGS,
				},
			);
			const { prompt } = await this.post<{ prompt: string }>(
				'/detokenize',
				{ model, tokens },
			);
			if (assistant) return { ids: tokens, text: prompt };
			const cut = prompt.lastIndexOf(PLACEHOLDER);
			if (cut === -1) {
				throw new Error(
					"Couldn't find the start of the message in the chat template",
				);
			}
			return { text: prompt.slice(0, cut) };
		});
	}

	/**
	 * A logit_bias that keeps generation from ending the turn, so lookahead
	 * paths don't stop short; ending is never a suggestion anyway. Reported
	 * logprobs are from before the bias, so they're unaffected.
	 */
	noEndBias(): Promise<Record<string, number>> {
		return this.cached('noEndBias', async () => {
			const model = await this.loadModel();
			const { tokens } = await this.post<{ tokens: number[] }>(
				'/tokenize',
				{
					model,
					prompt: '<|im_end|><|endoftext|>',
					add_special_tokens: false,
				},
			);
			return Object.fromEntries(tokens.map((id) => [id, -100]));
		});
	}

	async completions(
		body: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<CompletionResponse> {
		const model = await this.loadModel();
		return this.post<CompletionResponse>(
			'/v1/completions',
			{ model, ...body },
			signal,
		);
	}
}

/** `fetch`-backed transport. GET when there's no body. */
export function fetchPost(baseUrl: string, onTiming?: TimingFn): PostFn {
	return async <T>(path: string, body: unknown, signal?: AbortSignal) => {
		const t0 = performance.now();
		let ok = false;
		try {
			const res = await fetch(
				baseUrl + path,
				body === undefined
					? { signal }
					: {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(body),
							signal,
						},
			);
			if (!res.ok) {
				throw new Error(
					`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
				);
			}
			const json = (await res.json()) as T;
			ok = true;
			return json;
		} finally {
			onTiming?.({ path, ms: Math.round(performance.now() - t0), ok });
		}
	};
}

export function isSpecialToken(tok: string): boolean {
	return /^<\|.*\|>$/.test(tok);
}

/** A token made visible: newlines and tabs as glyphs, special tokens named. */
export function showToken(tok: string): string {
	if (isSpecialToken(tok)) return '⏹ (end)';
	return tok.replace(/\n/g, '↵').replace(/\t/g, '⇥');
}
