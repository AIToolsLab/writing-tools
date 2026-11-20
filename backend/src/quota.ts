/**
 * Per-user LLM spend caps.
 *
 * Each signed-in (or anonymous-demo) user has a daily and a weekly cap, in
 * dollars, checked by the OpenAI proxy *before* each request. Spend is computed
 * from `llm_usage` with the pricing.ts rate table, the same way the usage summary
 * computes it. Writers never see dollars — only percentages (see publicStatus).
 *
 * States, by the larger of the two windows' used fraction:
 *   - ok       (< 80%)
 *   - nearing  (≥ 80%): the client shows a heads-up.
 *   - fallback (≥ 100%): requests are still served, but on FALLBACK_MODEL (cheap)
 *     instead of whatever the client asked for.
 *   - blocked  (≥ HARD_LIMIT_MULTIPLIER × cap): refused with 429 until the window
 *     resets. On the fallback model this takes a lot of use to reach — it's a
 *     backstop against a runaway client, not a limit people should hit.
 *
 * The check runs before the request, so the request that crosses a line always
 * finishes (the "grace period"): overshoot is one request — or a few, if a user
 * has several in flight at once (several tabs, an external tool).
 *
 * Windows reset at RESET_HOUR local time in QUOTA_TIMEZONE: the daily window every
 * day, the weekly window on Mondays. A 7am reset means a late-night session
 * counts as one day.
 *
 * Caps are overridable per user in the `user_quota` table (see db.ts v5), by hand
 * for now:
 *   INSERT INTO user_quota (user_id, weekly_cap_usd) VALUES ('<id>', 5);
 *   INSERT INTO user_quota (user_id, exempt, note) VALUES ('<id>', 1, 'researcher');
 *
 * On top of the per-user caps there is one app-wide daily budget
 * (APP_DAILY_CAP_USD, default $20), over ALL spend: every user, exempt ones and
 * demo traffic included. Past it everyone is on the fallback model; past
 * APP_HARD_LIMIT_MULTIPLIER × it, every request is refused until the 7am reset.
 * It has no "nearing" state: writers can't do anything about the app's budget.
 * A user is held to whichever of the two is stricter; `scope` says which.
 */
import { db } from './db.js';
import { costUsd, maxOutputRate } from './pricing.js';
import { ANONYMOUS_USER_ID, DEMO_USER_ID } from './usage.js';

export const DEFAULT_DAILY_CAP_USD = 0.5;
export const DEFAULT_WEEKLY_CAP_USD = 1.0;
/** Served instead of the requested model once a user is over a cap. */
export const FALLBACK_MODEL = 'gpt-6-luna';
/** Fraction of a cap at which the client starts showing a heads-up. */
export const NEARING_FRACTION = 0.8;
/** Multiple of a cap at which even fallback requests are refused. */
export const HARD_LIMIT_MULTIPLIER = 3;
export const DEFAULT_APP_DAILY_CAP_USD = 20;
/**
 * Multiple of the app-wide budget at which everything is refused. Lower than the
 * per-user multiple: the app budget is a real budget, and on the fallback model
 * the extra half still buys thousands of requests.
 */
export const APP_HARD_LIMIT_MULTIPLIER = 1.5;
const RESET_HOUR = 7;

function quotaTimeZone(): string {
	return process.env.QUOTA_TIMEZONE || 'America/Detroit';
}

function appDailyCapUsd(): number {
	const fromEnv = Number(process.env.APP_DAILY_CAP_USD);
	return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_APP_DAILY_CAP_USD;
}

export type QuotaState = 'ok' | 'nearing' | 'fallback' | 'blocked';

interface WindowStatus {
	spentUsd: number;
	capUsd: number;
	/** spent / cap; can exceed 1. */
	fraction: number;
	resetsAt: number;
}

export interface QuotaStatus {
	/** False for exempt users and for buckets that aren't a person (demo, anonymous). */
	capped: boolean;
	state: QuotaState;
	/** Whose limit set `state`: the user's own caps, or the app-wide budget. */
	scope: 'user' | 'app';
	daily: WindowStatus | null;
	weekly: WindowStatus | null;
	/** When `state` lifts; null when it's ok and the user is uncapped. */
	resetsAt: number | null;
}

// --- time windows -------------------------------------------------------------

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock fields of `ms` in `timeZone`. */
function zonedParts(ms: number, timeZone: string) {
	let fmt = partsFormatters.get(timeZone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		});
		partsFormatters.set(timeZone, fmt);
	}
	const get = (type: string) =>
		Number(fmt.formatToParts(ms).find((p) => p.type === type)?.value);
	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour: get('hour'),
		minute: get('minute'),
		second: get('second'),
	};
}

/** UTC offset of `timeZone` at instant `ms`, in ms (local − UTC). */
function offsetMs(ms: number, timeZone: string): number {
	const p = zonedParts(ms, timeZone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which it is `hour`:00 on local calendar date (year, month, day)
 * in `timeZone`. Day may over/underflow (Date.UTC normalizes it). Two passes so
 * the offset is the one in force at the answer, not at the first guess — that's
 * what keeps DST transition days right.
 */
function localToUtc(
	year: number,
	month: number,
	day: number,
	hour: number,
	timeZone: string,
): number {
	const guess = Date.UTC(year, month - 1, day, hour);
	const first = guess - offsetMs(guess, timeZone);
	return guess - offsetMs(first, timeZone);
}

export interface QuotaWindows {
	dayStart: number;
	dayEnd: number;
	weekStart: number;
	weekEnd: number;
}

/** The current daily and weekly windows (half-open [start, end)) at `now`. */
export function quotaWindows(
	now: number,
	timeZone: string = quotaTimeZone(),
): QuotaWindows {
	const p = zonedParts(now, timeZone);
	// The "quota day" is the local calendar day whose RESET_HOUR most recently passed.
	let day = p.day;
	if (localToUtc(p.year, p.month, day, RESET_HOUR, timeZone) > now) day -= 1;
	const dayStart = localToUtc(p.year, p.month, day, RESET_HOUR, timeZone);
	const dayEnd = localToUtc(p.year, p.month, day + 1, RESET_HOUR, timeZone);
	// Weekday of that calendar date (pure calendar arithmetic, no time zone).
	const weekday = new Date(Date.UTC(p.year, p.month - 1, day)).getUTCDay();
	const sinceMonday = (weekday + 6) % 7;
	const weekStart = localToUtc(
		p.year,
		p.month,
		day - sinceMonday,
		RESET_HOUR,
		timeZone,
	);
	const weekEnd = localToUtc(
		p.year,
		p.month,
		day - sinceMonday + 7,
		RESET_HOUR,
		timeZone,
	);
	return { dayStart, dayEnd, weekStart, weekEnd };
}

// --- caps ---------------------------------------------------------------------

interface Caps {
	exempt: boolean;
	dailyUsd: number;
	weeklyUsd: number;
}

/** A metering bucket that isn't a person, so a per-person cap doesn't apply. */
function isSharedBucket(userId: string): boolean {
	return userId === DEMO_USER_ID || userId === ANONYMOUS_USER_ID;
}

function capsFor(userId: string): Caps {
	const row = db()
		.prepare(
			`SELECT daily_cap_usd, weekly_cap_usd, exempt FROM user_quota WHERE user_id = ?`,
		)
		.get(userId) as
		| { daily_cap_usd: number | null; weekly_cap_usd: number | null; exempt: number }
		| undefined;
	return {
		exempt: row?.exempt === 1,
		dailyUsd: row?.daily_cap_usd ?? DEFAULT_DAILY_CAP_USD,
		weeklyUsd: row?.weekly_cap_usd ?? DEFAULT_WEEKLY_CAP_USD,
	};
}

/** Remove a deleted account's override row (called from account deletion). */
export function deleteUserQuota(userId: string): void {
	db().prepare(`DELETE FROM user_quota WHERE user_id = ?`).run(userId);
}

// --- spend --------------------------------------------------------------------

type UsageSums = Record<string, number | string>;

const SUM_COLUMNS = `SUM(input_tokens) AS input_tokens,
	SUM(cached_input_tokens) AS cached_input_tokens,
	SUM(output_tokens) AS output_tokens,
	SUM(cache_write_tokens) AS cache_write_tokens,
	SUM(cache_write_30m_tokens) AS cache_write_30m_tokens`;

/**
 * Dollars for one per-model group of token sums.
 *
 * A model with no rate (history from before the proxy refused unpriced models) is
 * costed as if every token were output at the most expensive rate in the table:
 * overcounting stops someone early, undercounting removes their cap.
 */
function groupCost(r: UsageSums): number {
	const inputTokens = Number(r.input_tokens);
	const outputTokens = Number(r.output_tokens);
	return (
		costUsd({
			model: String(r.model),
			inputTokens,
			cachedInputTokens: Number(r.cached_input_tokens),
			outputTokens,
			cacheWriteTokens: Number(r.cache_write_tokens),
			cacheWrite30mTokens: Number(r.cache_write_30m_tokens),
		}) ?? ((inputTokens + outputTokens) * maxOutputRate()) / 1_000_000
	);
}

/**
 * Dollars spent by `userId` since `weekStart`, and the part of it since `dayStart`
 * (dayStart ≥ weekStart always: a week starts on a day boundary).
 */
function spend(
	userId: string,
	weekStart: number,
	dayStart: number,
): { dayUsd: number; weekUsd: number } {
	const rows = db()
		.prepare(
			`SELECT model, ts >= ? AS today, ${SUM_COLUMNS}
			FROM llm_usage
			WHERE user_id = ? AND ts >= ?
			GROUP BY model, today`,
		)
		.all(dayStart, userId, weekStart) as UsageSums[];

	let dayUsd = 0;
	let weekUsd = 0;
	for (const r of rows) {
		const cost = groupCost(r);
		weekUsd += cost;
		if (Number(r.today) === 1) dayUsd += cost;
	}
	return { dayUsd, weekUsd };
}

/**
 * Dollars spent by everyone since `dayStart`. Runs on every proxied request, with
 * no cache: the covering index from db.ts v6 keeps it about a millisecond for a
 * few thousand rows a day, growing linearly (~20ms at 100k rows/day).
 */
export const APP_SPEND_SQL = `SELECT model, ${SUM_COLUMNS} FROM llm_usage WHERE ts >= ? GROUP BY model`;

function appSpend(dayStart: number): number {
	const rows = db().prepare(APP_SPEND_SQL).all(dayStart) as UsageSums[];
	return rows.reduce((total, r) => total + groupCost(r), 0);
}

// --- status -------------------------------------------------------------------

function stateFor(fraction: number): QuotaState {
	if (fraction >= HARD_LIMIT_MULTIPLIER) return 'blocked';
	if (fraction >= 1) return 'fallback';
	if (fraction >= NEARING_FRACTION) return 'nearing';
	return 'ok';
}

const RANK: Record<QuotaState, number> = { ok: 0, nearing: 1, fallback: 2, blocked: 3 };

/** The user's own caps only. */
function userStatus(userId: string, w: QuotaWindows): Omit<QuotaStatus, 'scope'> {
	const uncapped = {
		capped: false,
		state: 'ok' as const,
		daily: null,
		weekly: null,
		resetsAt: null,
	};
	if (isSharedBucket(userId)) return uncapped;
	const caps = capsFor(userId);
	if (caps.exempt) return uncapped;

	const { dayUsd, weekUsd } = spend(userId, w.weekStart, w.dayStart);
	const daily: WindowStatus = {
		spentUsd: dayUsd,
		capUsd: caps.dailyUsd,
		fraction: caps.dailyUsd > 0 ? dayUsd / caps.dailyUsd : Infinity,
		resetsAt: w.dayEnd,
	};
	const weekly: WindowStatus = {
		spentUsd: weekUsd,
		capUsd: caps.weeklyUsd,
		fraction: caps.weeklyUsd > 0 ? weekUsd / caps.weeklyUsd : Infinity,
		resetsAt: w.weekEnd,
	};
	// The state is set by the more-used window. It lifts only once every window in
	// that state has reset, so report the latest of their resets (daily 120% and
	// weekly 105% are both "fallback" until the weekly reset).
	const state = stateFor(Math.max(daily.fraction, weekly.fraction));
	const resetsAt = Math.max(
		...[daily, weekly]
			.filter((win) => stateFor(win.fraction) === state)
			.map((win) => win.resetsAt),
	);
	return { capped: true, state, daily, weekly, resetsAt };
}

/** The app-wide daily budget's state: ok, fallback or blocked (never nearing). */
function appState(w: QuotaWindows): QuotaState {
	const fraction = appSpend(w.dayStart) / appDailyCapUsd();
	if (fraction >= APP_HARD_LIMIT_MULTIPLIER) return 'blocked';
	if (fraction >= 1) return 'fallback';
	return 'ok';
}

/**
 * Where `userId` stands at `now`: the stricter of their own caps and the app-wide
 * budget. On a tie the user's own caps are reported, since they may last longer.
 */
export function quotaStatus(userId: string, now: number = Date.now()): QuotaStatus {
	const w = quotaWindows(now);
	const user = userStatus(userId, w);
	const app = appState(w);
	if (RANK[app] > RANK[user.state]) {
		return { ...user, state: app, scope: 'app', resetsAt: w.dayEnd };
	}
	return { ...user, scope: 'user' };
}

/** Percent of a window used, rounded, for display. */
function percent(w: WindowStatus | null): number | null {
	if (!w) return null;
	return Number.isFinite(w.fraction) ? Math.round(w.fraction * 100) : 100;
}

/**
 * What the client is told: percentages and reset times, never dollars (a
 * deliberate product choice — see docs/llm-quota.md).
 */
export function publicStatus(status: QuotaStatus) {
	const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
	return {
		capped: status.capped,
		state: status.state,
		scope: status.scope,
		daily: status.daily
			? { percentUsed: percent(status.daily), resetsAt: iso(status.daily.resetsAt) }
			: null,
		weekly: status.weekly
			? { percentUsed: percent(status.weekly), resetsAt: iso(status.weekly.resetsAt) }
			: null,
		resetsAt: iso(status.resetsAt),
		fallbackModel: FALLBACK_MODEL,
	};
}
