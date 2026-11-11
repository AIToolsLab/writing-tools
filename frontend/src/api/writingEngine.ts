/**
 * Thin client for the writing engine: a small llama.cpp-based server from
 * AIToolsLab/writing-prototypes (`engine/`, see its README and MIGRATING.md).
 * It replaced the stock vLLM server the Workbench first used.
 *
 * The engine answers in characters, not tokens. Given a templated prompt and
 * the text typed after it, `/v1/continuations` returns likely continuations
 * with the model's probability of each, conditioned on the typed *characters*
 * (summed over every way they could be tokenized), and `/v1/score` returns how
 * likely each token of a text was and what the model expected there instead.
 * So the client does no token healing and no tokenizing of its own.
 *
 * It talks to the server directly from the browser (no token, CORS open), so
 * these requests bypass the backend: no auth, no consent stripping, no
 * `llm_usage` metering. Every request reports its duration through `onTiming`.
 */

export const ENGINE_URL: string = (
	import.meta.env.VITE_ENGINE_URL || 'https://llm.thoughtful-ai.com'
).replace(/\/+$/, '');

/**
 * Names this tab's cache on the server, so several writers don't evict each
 * other's. A newer `/v1/continuations` request from the same session
 * supersedes older ones, which come back 409 (thrown here as an AbortError).
 */
export const SESSION: string =
	globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2);

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

/** One token (or several that split a character) of a scored text. */
export interface ScoredToken {
	text: string;
	logprob: number;
	/** The model's top choice at this position. */
	top: string;
	top_logprob: number;
}

export interface ScoreResponse {
	tokens: ScoredToken[];
	stats: { text_tokens: number; total_ms: number };
}

export interface Continuation {
	/** Text to append to the draft. */
	text: string;
	/**
	 * P(the reply continues this way | the characters typed). For a
	 * correction, how many times as likely it is as all the paths that keep to
	 * the typed text.
	 */
	prob: number;
	/** The model would end the message after this text. */
	end: boolean;
	/** The continuation reached the stop condition (vs. was cut short). */
	done: boolean;
	/**
	 * A correction: the number of *bytes* (UTF-8) at the end of the typed text
	 * that `text` replaces. Only the last word is reconsidered.
	 */
	replace?: number;
}

export interface ContinuationsResponse {
	typed: string;
	continuations: Continuation[];
	/** Share of the typed text's probability that wasn't explored. */
	unresolved: number;
	stats: { total_ms: number; decoded_tokens: number; rounds: number };
}

const PLACEHOLDER = 'XYZZYPLACEHOLDER';

export class EngineClient {
	private model: Promise<string> | null = null;
	/** A few recent prefix renders, keyed by their inputs. */
	private cache = new Map<string, Promise<string>>();

	constructor(
		private readonly post: PostFn,
		private readonly maxCached = 8,
	) {}

	/** The server's model name, for display and logs. */
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

	/**
	 * The chat-templated prompt up to where a message from `role` starts, after
	 * `history`. For an assistant turn that's the generation prompt (thinking
	 * off, the server's default). A user turn has none, so render it with a
	 * placeholder as its content and cut there.
	 */
	turnPrefix(
		history: ChatMessage[],
		role: ChatMessage['role'],
	): Promise<string> {
		const key = JSON.stringify([role, history]);
		let hit = this.cache.get(key);
		if (!hit) {
			hit = this.renderPrefix(history, role);
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

	private async renderPrefix(
		history: ChatMessage[],
		role: ChatMessage['role'],
	): Promise<string> {
		if (role === 'assistant') {
			const { prompt } = await this.post<{ prompt: string }>(
				'/v1/template',
				{ messages: history, add_generation_prompt: true },
			);
			return prompt;
		}
		const { prompt } = await this.post<{ prompt: string }>('/v1/template', {
			messages: [...history, { role, content: PLACEHOLDER }],
			add_generation_prompt: false,
		});
		const cut = prompt.lastIndexOf(PLACEHOLDER);
		if (cut === -1) {
			throw new Error(
				"Couldn't find the start of the message in the chat template",
			);
		}
		return prompt.slice(0, cut);
	}

	score(
		body: { prompt: string; text: string },
		signal?: AbortSignal,
	): Promise<ScoreResponse> {
		return this.post('/v1/score', { session: SESSION, ...body }, signal);
	}

	continuations(
		body: {
			prompt: string;
			text: string;
			stop?: string;
			units?: number;
			/** Also return corrections at least this many times as likely. */
			corrections?: number;
			max_chars?: number;
			/** Cap on the search, in ms. */
			time_ms?: number;
		},
		signal?: AbortSignal,
	): Promise<ContinuationsResponse> {
		return this.post(
			'/v1/continuations',
			{ session: SESSION, ...body },
			signal,
		);
	}
}

/**
 * `fetch`-backed transport. GET when there's no body. POSTs go as
 * `text/plain`, a "simple" request, so there's no CORS preflight per keystroke.
 */
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
							headers: { 'Content-Type': 'text/plain' },
							body: JSON.stringify(body),
							signal,
						},
			);
			if (res.status === 409) {
				throw new DOMException('superseded', 'AbortError');
			}
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
