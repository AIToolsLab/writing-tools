/**
 * "AI usage" on the account page: how much of today's and this week's allowance
 * the writer has used, as percentages (never dollars), and when each resets.
 * Backed by GET /api/me/quota (backend/src/quota.ts).
 */
import { useEffect, useState } from 'react';
import { SERVER_URL } from '@/api';
import {
	fetchQuota,
	formatReset,
	type QuotaStatus,
	type QuotaWindow,
} from '@/api/quota';
import { useAppAuth } from '@/contexts/appAuthContext';
import classes from './styles.module.css';

function WindowLine({ label, window }: { label: string; window: QuotaWindow }) {
	return (
		<div className={classes.usageRow}>
			<div className={classes.usageLabel}>
				<span>
					{label}: <strong>{window.percentUsed}%</strong> used
				</span>
				<span className={classes.muted}>
					resets {formatReset(window.resetsAt)}
				</span>
			</div>
			<progress
				className={classes.usageBar}
				max={100}
				value={Math.min(window.percentUsed, 100)}
				aria-label={`${label}: ${window.percentUsed}% of AI allowance used`}
			/>
		</div>
	);
}

export function UsageSection() {
	const session = useAppAuth();
	const [status, setStatus] = useState<QuotaStatus | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const token = await session.getAccessToken();
				const result = await fetchQuota(`${SERVER_URL}/me/quota`, (url, init) =>
					fetch(url, {
						...init,
						headers: { Authorization: `Bearer ${token}` },
					}),
				);
				if (!cancelled) setStatus(result);
			} catch {
				if (!cancelled) setFailed(true);
			}
		})();
		return () => {
			cancelled = true;
		};
		// Once per page load; the page is reopened to refresh.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<section className={classes.section}>
			<h2 className={classes.h2}>AI usage</h2>
			{failed ? (
				<p className={classes.muted}>Could not load your AI usage.</p>
			) : !status ? (
				<p className={classes.muted}>Loading…</p>
			) : !status.capped ? (
				<p className={classes.sectionIntro}>
					This account has no AI usage limit.
				</p>
			) : (
				<>
					<p className={classes.sectionIntro}>
						Each account has a daily and a weekly AI allowance. When
						either reaches 100%, responses come from a smaller, more
						limited model until it resets. Voice isn’t available on
						accounts with an allowance.
					</p>
					{status.daily ? (
						<WindowLine label="Today" window={status.daily} />
					) : null}
					{status.weekly ? (
						<WindowLine label="This week" window={status.weekly} />
					) : null}
					{status.state === 'blocked' ? (
						<p className={classes.error}>
							AI features are paused until{' '}
							{status.resetsAt ? formatReset(status.resetsAt) : 'your allowance resets'}.
						</p>
					) : null}
				</>
			)}
		</section>
	);
}
