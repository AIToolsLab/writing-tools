/**
 * Standalone account/consent entry — reachable without the Word task pane or
 * editor loaded (its own Vite input: account.html). Gated on a Better Auth
 * session; unauthenticated or demo/anonymous visitors are steered to real sign-in
 * before they can manage consent or exercise deletion rights.
 *
 * overallModeAtom defaults to OverallMode.full, so AppAuthProvider selects the
 * real Better Auth adapter (not the demo adapter) here.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Reshaped } from 'reshaped';
import 'reshaped/themes/slate/theme.css';
import { AppAuthProvider, useAppAuth } from '@/contexts/appAuthContext';
import { AccountPage } from './AccountPage';
import { DeviceCodePanel } from './DeviceCodePanel';
import classes from './styles.module.css';

function SignInGate() {
	const session = useAppAuth();

	if (session.isLoading) {
		return <p className={classes.centered}>Loading…</p>;
	}

	if (!session.isAuthenticated || !session.user) {
		return (
			<main className={classes.page}>
				<h1 className={classes.h1}>Account &amp; privacy</h1>
				<p className={classes.sectionIntro}>
					Sign in to view and manage your privacy settings.
				</p>
				{session.isAuthorizing ? (
					<DeviceCodePanel authorization={session.authorization} />
				) : (
					<>
						{/* A failed/denied device flow surfaces via authorization.status
						    ('error'), not session.error — render it so a sign-in failure
						    isn't silent, and keep the button so the user can retry. */}
						{session.authorization?.status === 'error' ? (
							<DeviceCodePanel
								authorization={session.authorization}
							/>
						) : null}
						<Button onClick={() => void session.login()}>
							Sign in
						</Button>
					</>
				)}
			</main>
		);
	}

	if (session.user.isAnonymous) {
		return (
			<main className={classes.page}>
				<h1 className={classes.h1}>Account &amp; privacy</h1>
				<p className={classes.sectionIntro}>
					You’re using a temporary demo account. Sign in with a real
					account to manage your privacy settings.
				</p>
				{session.isAuthorizing ? (
					<DeviceCodePanel authorization={session.authorization} />
				) : (
					<>
						{session.authorization?.status === 'error' ? (
							<DeviceCodePanel
								authorization={session.authorization}
							/>
						) : null}
						<Button onClick={() => void session.login()}>
							Sign in with Google
						</Button>
					</>
				)}
			</main>
		);
	}

	return <AccountPage />;
}

const container = document.getElementById('container');
if (container) {
	createRoot(container).render(
		<StrictMode>
			<Reshaped theme="slate">
				<AppAuthProvider>
					<SignInGate />
				</AppAuthProvider>
			</Reshaped>
		</StrictMode>,
	);
}
