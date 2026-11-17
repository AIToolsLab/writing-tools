/**
 * The one way a page tells the writer that something did not work.
 *
 * Every failure the writer can see should go through this component, so a
 * failed generation never looks like an empty result. It shows the
 * plain-language sentence from {@link GenerationErrorInfo}, keeps the raw
 * provider text behind a collapsed disclosure (so a bug report can carry the
 * real error without putting `insufficient_quota` in the writer's face), and
 * offers Retry only when retrying could plausibly work.
 */
import { useState } from 'react';
import {
	AiOutlineExclamationCircle,
	AiOutlineInfoCircle,
} from 'react-icons/ai';
import type { GenerationErrorInfo } from '@/api/errors';
import classes from './styles.module.css';

interface ErrorNoticeProps {
	/** `error` for a failure, `info` for a benign non-result (e.g. empty output). */
	tone?: 'error' | 'info';
	/** Overrides the default heading ("Something went wrong" / "No results"). */
	title?: string;
	message: string;
	/** Raw provider/transport text, shown under "Technical details". */
	detail?: string;
	/** Rendered as a Retry button when provided. */
	onRetry?: () => void;
}

export function ErrorNotice({
	tone = 'error',
	title,
	message,
	detail,
	onRetry,
}: ErrorNoticeProps) {
	const [showDetail, setShowDetail] = useState(false);
	const Icon =
		tone === 'error' ? AiOutlineExclamationCircle : AiOutlineInfoCircle;
	const heading =
		title ?? (tone === 'error' ? 'Something went wrong' : 'No results');
	// Assertive for errors: the writer is waiting on a result that is not coming.
	const role = tone === 'error' ? 'alert' : 'status';

	return (
		<div className={`${classes.notice} ${classes[tone]}`} role={role}>
			<div className={classes.head}>
				<Icon className={classes.icon} aria-hidden="true" />
				<div className={classes.title}>{heading}</div>
			</div>
			<div className={classes.message}>{message}</div>
			{detail || onRetry ? (
				<div className={classes.actions}>
					{onRetry ? (
						<button
							type="button"
							className={classes.retry}
							onClick={onRetry}
						>
							Try again
						</button>
					) : null}
					{detail ? (
						<button
							type="button"
							className={classes.detailToggle}
							aria-expanded={showDetail}
							onClick={() => setShowDetail((shown) => !shown)}
						>
							{showDetail ? 'Hide details' : 'Technical details'}
						</button>
					) : null}
				</div>
			) : null}
			{detail && showDetail ? (
				<pre className={classes.detail}>{detail}</pre>
			) : null}
		</div>
	);
}

/**
 * Convenience wrapper for the common case: a {@link GenerationErrorInfo} from
 * `describeGenerationError`. Retry is offered only when the failure is one that
 * retrying can clear — an out-of-credit account is not.
 */
export function GenerationErrorNotice({
	info,
	title,
	onRetry,
}: {
	info: GenerationErrorInfo;
	title?: string;
	onRetry?: () => void;
}) {
	return (
		<ErrorNotice
			tone="error"
			title={title}
			message={info.message}
			detail={info.detail}
			onRetry={info.retryable ? onRetry : undefined}
		/>
	);
}
