/**
 * Heads-up about the writer's AI spend cap, shown above the page content.
 *
 * Driven by the quota state the proxy reports on each model response (see
 * api/quota.ts), so it appears as soon as a request crosses a threshold, with no
 * polling. When the state changes it fetches the detail (percent, reset time)
 * for the wording. Percentages only, never dollars.
 *
 *   nearing  → "you've used 85% of this week's allowance", dismissible
 *   fallback → responses now come from a smaller model, until the reset
 *   blocked  → nothing more until the reset (generation also fails with the
 *              quota_exceeded copy in api/errors.ts; this says when it lifts)
 */
import { useEffect, useState } from 'react';
import { SERVER_URL } from '@/api';
import { accountPageUrl } from '@/api/account';
import { authorizedFetch } from '@/api/openai';
import {
	busiestWindow,
	fetchQuota,
	formatReset,
	type QuotaState,
	type QuotaStatus,
	useQuotaSignal,
} from '@/api/quota';
import classes from './styles.module.css';

const TITLES: Record<Exclude<QuotaState, 'ok'>, string> = {
	nearing: 'Approaching your AI limit',
	fallback: 'Using a smaller AI model',
	blocked: 'AI limit reached',
};

export function quotaNoticeMessage(
	state: Exclude<QuotaState, 'ok'>,
	status: QuotaStatus | null,
): string {
	const busiest = status ? busiestWindow(status) : null;
	const until = status?.resetsAt ? ` until ${formatReset(status.resetsAt)}` : '';
	const allowance = busiest
		? `${busiest.label === 'today' ? 'today’s' : 'this week’s'} AI allowance`
		: 'your AI allowance';
	switch (state) {
		case 'nearing':
			return busiest
				? `You’ve used ${busiest.window.percentUsed}% of ${allowance}. After 100%, responses come from a smaller model${until}.`
				: 'You’re close to your AI usage limit. After that, responses come from a smaller model until it resets.';
		case 'fallback':
			return `You’ve used ${allowance}, so responses now come from a smaller, more limited model${until}.`;
		case 'blocked':
			return `You’ve gone well past ${allowance}, so AI features are paused${until}.`;
	}
}

export function QuotaNotice() {
	const state = useQuotaSignal();
	const [status, setStatus] = useState<QuotaStatus | null>(null);
	const [dismissed, setDismissed] = useState<QuotaState | null>(null);

	useEffect(() => {
		if (!state || state === 'ok') return;
		let cancelled = false;
		fetchQuota(`${SERVER_URL}/me/quota`, authorizedFetch)
			.then((s) => {
				if (!cancelled) setStatus(s);
			})
			.catch(() => {
				// The notice still shows, just without the percent and reset time.
			});
		return () => {
			cancelled = true;
		};
	}, [state]);

	if (!state || state === 'ok' || dismissed === state) return null;

	const tone = state === 'blocked' ? classes.error : classes.info;
	return (
		<div className={`${classes.notice} ${tone}`} role="status">
			<div className={classes.head}>
				<span>{TITLES[state]}</span>
				<button
					type="button"
					className={classes.dismiss}
					aria-label="Dismiss"
					onClick={() => setDismissed(state)}
				>
					×
				</button>
			</div>
			<div>
				{quotaNoticeMessage(state, status)}{' '}
				<a
					className={classes.link}
					href={accountPageUrl()}
					target="_blank"
					rel="noopener"
				>
					Details
				</a>
			</div>
		</div>
	);
}
