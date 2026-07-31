/**
 * Standalone account & privacy page (authenticated).
 *
 * Lets a signed-in user exercise the "Your Rights and Choices" actions from the
 * privacy policy, which are deliberately three *different* things:
 *   - change their logging-consent level        → POST /api/me/consent
 *   - erase their logged activity (withdrawal)   → DELETE /api/me/activity
 *   - delete their account (departure)           → POST /api/auth/delete-user
 *
 * Delete requires a *fresh* session (Better Auth freshAge). Our Google-only
 * accounts have no password and no email-verification flow, so a stale session is
 * rejected and we drive a re-authentication before retrying — the re-auth doubles
 * as the strong confirmation an irreversible action deserves.
 */
import { useState } from 'react';
import { Button } from 'reshaped';
import { changeConsent, deleteAccount, eraseActivity } from '@/api/account';
import { clearToken, loadToken } from '@/api/authTokenStore';
import { ConsentLevelChooser } from '@/components/ConsentLevelChooser';
import type { ConsentLevel } from '@/consent';
import { useAppAuth } from '@/contexts/appAuthContext';
import { DeviceCodePanel } from './DeviceCodePanel';
import classes from './styles.module.css';

type ConsentStatus = 'idle' | 'saving' | 'saved' | 'error';
type EraseStatus = 'idle' | 'confirm' | 'working' | 'done' | 'error';
type DeleteStatus =
	'idle' | 'confirm' | 'working' | 'needs-reauth' | 'done' | 'error';

export function AccountPage() {
	const session = useAppAuth();

	const [level, setLevel] = useState<ConsentLevel>(session.loggingConsent);
	const [consentStatus, setConsentStatus] = useState<ConsentStatus>('idle');

	const [eraseStatus, setEraseStatus] = useState<EraseStatus>('idle');
	const [eraseError, setEraseError] = useState<string | null>(null);

	const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>('idle');
	const [deleteError, setDeleteError] = useState<string | null>(null);

	// --- change logging level -------------------------------------------------
	const onChangeLevel = async (next: ConsentLevel) => {
		const previous = level;
		setLevel(next); // optimistic
		setConsentStatus('saving');
		try {
			const token = await session.getAccessToken();
			await changeConsent(token, next);
			setConsentStatus('saved');
		} catch {
			setLevel(previous); // roll back on failure
			setConsentStatus('error');
		}
	};

	// --- erase activity (withdrawal) ------------------------------------------
	const onErase = async () => {
		setEraseStatus('working');
		setEraseError(null);
		try {
			const token = await session.getAccessToken();
			await eraseActivity(token);
			setEraseStatus('done');
		} catch {
			setEraseStatus('error');
			setEraseError('Could not erase your activity. Please try again.');
		}
	};

	// --- delete account (departure) -------------------------------------------
	const runDelete = async () => {
		setDeleteStatus('working');
		setDeleteError(null);
		let token: string | null;
		try {
			token = await session.getAccessToken();
		} catch {
			token = loadToken();
		}
		if (!token) {
			setDeleteStatus('needs-reauth');
			return;
		}
		let result: Awaited<ReturnType<typeof deleteAccount>>;
		try {
			result = await deleteAccount(token);
		} catch {
			setDeleteStatus('error');
			setDeleteError('Could not delete your account. Please try again.');
			return;
		}
		if (result.ok) {
			clearToken();
			setDeleteStatus('done');
			return;
		}
		if (result.staleSession) {
			// Session too old to delete — require a fresh sign-in, then retry.
			setDeleteStatus('needs-reauth');
			return;
		}
		setDeleteStatus('error');
		setDeleteError(
			`Could not delete your account (error ${result.status}).`,
		);
	};

	return (
		<main className={classes.page}>
			<h1 className={classes.h1}>Account &amp; privacy</h1>
			{session.user?.email ? (
				<p className={classes.muted}>
					Signed in as {session.user.email}
				</p>
			) : null}

			{/* Logging level */}
			<section className={classes.section}>
				<h2 className={classes.h2}>What we log about you</h2>
				<p className={classes.sectionIntro}>
					Choose how much this app records about your usage. You can
					change this at any time; lowering it stops new logging
					immediately.
				</p>
				<ConsentLevelChooser
					value={level}
					onChange={(next) => void onChangeLevel(next)}
					disabled={consentStatus === 'saving'}
				/>
				<p className={classes.statusLine}>
					{consentStatus === 'saving' && 'Saving…'}
					{consentStatus === 'saved' && 'Saved.'}
					{consentStatus === 'error' &&
						'Could not save your choice. Please try again.'}
				</p>
			</section>

			{/* Erase activity — withdrawal */}
			<section className={classes.section}>
				<h2 className={classes.h2}>Erase my logged activity</h2>
				<p className={classes.sectionIntro}>
					Deletes the logged events and analytics profile we hold
					about how you use the app.{' '}
					<strong>Your account stays</strong> and you can keep using
					the app. Active Mindmap rooms stay available. This does not
					delete the content-free AI usage records we keep for
					billing.
				</p>
				{eraseStatus === 'done' ? (
					<p className={classes.ok}>
						Your logged activity has been erased.
					</p>
				) : eraseStatus === 'confirm' ? (
					<div className={classes.actionRow}>
						<span>
							Erase all logged activity? This can’t be undone.
						</span>
						<Button onClick={() => void onErase()}>
							Yes, erase it
						</Button>
						<Button onClick={() => setEraseStatus('idle')}>
							Cancel
						</Button>
					</div>
				) : (
					<Button
						disabled={eraseStatus === 'working'}
						onClick={() => setEraseStatus('confirm')}
					>
						{eraseStatus === 'working'
							? 'Erasing…'
							: 'Erase my activity'}
					</Button>
				)}
				{eraseError ? (
					<p className={classes.error}>{eraseError}</p>
				) : null}
			</section>

			{/* Delete account — departure */}
			<section className={classes.section}>
				<h2 className={classes.h2}>Delete my account</h2>
				<p className={classes.sectionIntro}>
					Permanently deletes your account and everything erasing
					does, plus the account itself. Content-free AI usage records
					are anonymized, not deleted.{' '}
					<strong>This cannot be undone.</strong>
				</p>

				{deleteStatus === 'done' ? (
					<p className={classes.ok}>
						Your account has been deleted. You can close this page.
					</p>
				) : deleteStatus === 'needs-reauth' ? (
					<div>
						<p>
							For your security, sign in again. After signing in,
							start the deletion confirmation again.
						</p>
						{session.isAuthorizing ? (
							<DeviceCodePanel
								authorization={session.authorization}
							/>
						) : (
							<>
								{/* Failed/denied re-auth surfaces via authorization.status
								    ('error'); show it alongside the buttons so the user can
								    retry instead of silently returning to the button row. */}
								{session.authorization?.status === 'error' ? (
									<DeviceCodePanel
										authorization={session.authorization}
									/>
								) : null}
								<div className={classes.actionRow}>
									<Button
										onClick={() => void session.login()}
									>
										Sign in again
									</Button>
									<Button onClick={() => void runDelete()}>
										Delete permanently
									</Button>
									<Button
										onClick={() => setDeleteStatus('idle')}
									>
										Cancel
									</Button>
								</div>
							</>
						)}
					</div>
				) : deleteStatus === 'confirm' ? (
					<div className={classes.actionRow}>
						<span>Delete your account permanently?</span>
						<Button onClick={() => void runDelete()}>
							Delete permanently
						</Button>
						<Button onClick={() => setDeleteStatus('idle')}>
							Cancel
						</Button>
					</div>
				) : (
					<Button
						disabled={deleteStatus === 'working'}
						onClick={() => setDeleteStatus('confirm')}
					>
						{deleteStatus === 'working'
							? 'Deleting…'
							: 'Delete my account'}
					</Button>
				)}
				{deleteError ? (
					<p className={classes.error}>{deleteError}</p>
				) : null}
			</section>
		</main>
	);
}
