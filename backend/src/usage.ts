/**
 * LLM usage metering — a content-free, per-user record of every model request we
 * pay for.
 *
 * This is operational/billing data, deliberately NOT part of the logging-consent
 * tiers in consent.ts: we record it at every level, including `none`, because we
 * are billed for the request regardless of whether the user opted into study
 * logging. It carries no prompt, no completion, no document text — only who,
 * when, which model, and how many tokens.
 *
 * The `llm_usage` table lives in the shared application database (db.ts), whose
 * schema owns its definition. Its identity column is a bare `user_id` with no
 * foreign key to `user`: a cascade would delete exactly the rows we want to keep
 * when an account goes away (see anonymizeUserUsage).
 */
import { db } from './db.js';

/** user_id value for rows whose account has been deleted (see anonymizeUserUsage). */
export const DELETED_USER_ID = 'deleted';

/**
 * Buckets for requests that have no account behind them. They are distinct because
 * a *different OpenAI key* pays for each, and the summary has to reconcile against
 * the right invoice: `demo` is the capped Thoughtful-demo project (demo mode, the
 * pre-sign-in editor), `anonymous` is the main key being spent by local dev with
 * auth switched off. See attributeRequest in openaiProxy.ts.
 */
export const DEMO_USER_ID = 'demo';
export const ANONYMOUS_USER_ID = 'anonymous';

/**
 * One metered request. Token counts follow OpenAI's accounting, where
 * `cachedInputTokens` is a SUBSET of `inputTokens` (not an addition to it) and
 * `reasoningTokens` is a subset of `outputTokens`. pricing.ts relies on that.
 *
 * The two timings measure different things and neither is "latency" on its own:
 * `durationMs` is the whole round trip (request sent → last byte), which for a
 * stream is the entire generation; `ttftMs` is time to the first byte of the
 * response body — what the user actually waits for before text starts appearing.
 * A fast-starting, slow-finishing generation and its opposite have the same
 * duration, so only ttft says whether the assistant *feels* slow. It is null for
 * non-streaming requests, where there's no first token distinct from the last.
 */
export interface UsageRecord {
	userId: string;
	provider: string;
	endpoint: string;
	model: string;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	status: number;
	streamed: boolean;
	durationMs: number;
	ttftMs: number | null;
}

/** Insert one metered request. */
export function recordUsage(record: UsageRecord): void {
	db()
		.prepare(
			`INSERT INTO llm_usage (
				ts, user_id, provider, endpoint, model,
				input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
				status, streamed, duration_ms, ttft_ms
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			Date.now(),
			record.userId,
			record.provider,
			record.endpoint,
			record.model,
			record.inputTokens,
			record.cachedInputTokens,
			record.outputTokens,
			record.reasoningTokens,
			record.status,
			record.streamed ? 1 : 0,
			record.durationMs,
			record.ttftMs,
		);
}

/**
 * Detach a deleted account's usage rows from its identity, keeping the tokens.
 *
 * Called from Better Auth's `beforeDelete` hook. Billing history has to survive
 * account deletion or our per-user totals stop reconciling with the provider's
 * invoice — but nothing identifying may survive, so every departed user's rows
 * collapse into one shared `deleted` bucket. A random per-user tombstone would
 * still be a pseudonym (it would let you re-single-out the person), which is the
 * thing deletion is supposed to prevent.
 */
export function anonymizeUserUsage(userId: string): void {
	db()
		.prepare(`UPDATE llm_usage SET user_id = ? WHERE user_id = ?`)
		.run(DELETED_USER_ID, userId);
}

export interface UsageSummaryRow {
	userId: string;
	email: string | null;
	provider: string;
	model: string;
	requests: number;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
}

/**
 * Per-user, per-model token totals over a time window (epoch ms, `until`
 * exclusive). Returns tokens only — dollars are computed by pricing.ts at read
 * time, so a rate change or a correction re-prices history instead of baking a
 * possibly-wrong number into the row.
 */
export function summarizeUsage(
	since: number,
	until: number,
): UsageSummaryRow[] {
	const rows = db()
		.prepare(
			`SELECT user_id, provider, model,
				COUNT(*) AS requests,
				SUM(input_tokens) AS input_tokens,
				SUM(cached_input_tokens) AS cached_input_tokens,
				SUM(output_tokens) AS output_tokens,
				SUM(reasoning_tokens) AS reasoning_tokens
			FROM llm_usage
			WHERE ts >= ? AND ts < ?
			GROUP BY user_id, provider, model
			ORDER BY user_id, provider, model`,
		)
		.all(since, until) as Array<Record<string, string | number>>;

	const emails = userEmails();
	return rows.map((r) => ({
		userId: String(r.user_id),
		email: emails.get(String(r.user_id)) ?? null,
		provider: String(r.provider),
		model: String(r.model),
		requests: Number(r.requests),
		inputTokens: Number(r.input_tokens),
		cachedInputTokens: Number(r.cached_input_tokens),
		outputTokens: Number(r.output_tokens),
		reasoningTokens: Number(r.reasoning_tokens),
	}));
}

/**
 * user id → email, for labelling the summary. Better Auth owns the `user` table;
 * when auth has never run (tests, a fresh dev DB) it doesn't exist yet, so a
 * missing table just means unlabelled ids rather than a failed summary.
 */
function userEmails(): Map<string, string> {
	try {
		const rows = db().prepare(`SELECT id, email FROM user`).all() as Array<{
			id: string;
			email: string;
		}>;
		return new Map(rows.map((r) => [r.id, r.email]));
	} catch {
		return new Map();
	}
}
