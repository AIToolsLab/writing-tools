/**
 * Renders the in-flight device-authorization state (user code + approval link)
 * for the account page — reused by the sign-in gate and the delete re-auth step.
 * Presentation only; the flow itself is driven by useDeviceAuth via useAppAuth.
 */
import type { AppAuthSession } from '@/contexts/appAuthContext';
import classes from './styles.module.css';

export function DeviceCodePanel({
	authorization,
}: {
	authorization: AppAuthSession['authorization'];
}) {
	if (!authorization) return null;

	if (authorization.status === 'error') {
		return (
			<p className={classes.error}>
				Sign-in failed: {authorization.error ?? 'unknown error'}
			</p>
		);
	}

	return (
		<div className={classes.deviceCode}>
			{authorization.userCode ? (
				<>
					<p>Enter this code on the sign-in page:</p>
					<p className={classes.code}>{authorization.userCode}</p>
				</>
			) : (
				<p>Starting sign-in…</p>
			)}
			{authorization.verificationUri ? (
				<a
					className={classes.link}
					href={authorization.verificationUri}
					target="_blank"
					rel="noopener noreferrer"
				>
					Open sign-in page →
				</a>
			) : null}
			<p className={classes.muted}>Waiting for approval…</p>
		</div>
	);
}
