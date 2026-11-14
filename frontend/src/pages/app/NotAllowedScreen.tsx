/**
 * Shown to a signed-in user who doesn't pass the beta access check (`isAllowed`,
 * decided server-side in backend/src/userAllowlist.ts). Shared by every surface
 * that renders pages/app: the Word task pane and the Google Docs sidebar.
 *
 * Access can be granted while the add-in is open (an operator sets `alwaysAllow`),
 * so "Check again" re-fetches the session instead of making the user sign out and
 * back in. The signed-in email is shown because Google sign-in always offers an
 * account chooser, and picking the wrong account is the likeliest reason a user who
 * was granted access still lands here.
 */
import { useState } from 'react';
import { Button } from 'reshaped';
import { useAppAuth } from '@/contexts/appAuthContext';
import classes from './styles.module.css';

type CheckStatus = 'idle' | 'checking' | 'still-not-allowed' | 'error';

export function NotAllowedScreen() {
	const session = useAppAuth();
	const [check, setCheck] = useState<CheckStatus>('idle');

	async function checkAgain() {
		setCheck('checking');
		try {
			await session.refreshUser();
			// If access was granted, this screen unmounts on the session update and
			// this state is never seen.
			setCheck('still-not-allowed');
		} catch {
			setCheck('error');
		}
	}

	const email = session.user?.email;

	return (
		<div className={classes.notAllowedContainer}>
			<p className={classes.notAllowedTitle}>
				This account doesn’t have access yet
			</p>
			{email ? (
				<p>
					Signed in as <strong>{email}</strong>.
				</p>
			) : null}
			<hr />
			<p>
				Thoughtful is in closed beta. Calvin University accounts have
				access automatically; other accounts are added by the Thoughtful
				team.
			</p>
			<p>If you’ve just been given access, check again.</p>
			<Button
				color="primary"
				variant="solid"
				loading={check === 'checking'}
				onClick={() => void checkAgain()}
			>
				Check again
			</Button>
			<p role="status" className={classes.notAllowedStatus}>
				{check === 'still-not-allowed'
					? 'Still no access for this account. If you were given access under a different email, sign out and sign in with that one.'
					: check === 'error'
						? 'Couldn’t check right now. Try again in a moment.'
						: null}
			</p>
			<hr />
			<p>
				<a
					href="https://thoughtful-ai.com/"
					className={classes.ibtn}
					target="_blank"
				>
					Contact us
				</a>
				if you’d like to try Thoughtful.
			</p>
			<Button
				color="neutral"
				variant="outline"
				onClick={() => void session.logout()}
			>
				Sign out
			</Button>
		</div>
	);
}
