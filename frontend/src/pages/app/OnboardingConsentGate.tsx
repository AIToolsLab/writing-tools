/**
 * First-run consent gate, shown right after sign-in while the user has never set a
 * consent level (session.hasSetConsent === false). Reuses the shared
 * ConsentLevelChooser + useConsent so it stays in lockstep with the account page.
 *
 * An affirmative choice is REQUIRED: Continue is the only way out, and it commits
 * the current selection (confirming the default counts as a choice), stamping
 * consentUpdatedAt. That refreshes the session's hasSetConsent, which unmounts this
 * gate — so on success the app renders, and on failure the gate stays up with its
 * error rather than proceeding with consent unset. There is deliberately no Skip —
 * the app (and thus any logging) doesn't render until a level is chosen, so
 * logging never precedes affirmative consent. A Skip that dismissed the gate while
 * leaving the 'usage' default active was considered and rejected for that reason.
 */
import { Button } from 'reshaped';
import { ConsentLevelChooser } from '@/components/ConsentLevelChooser';
import { useAppAuth } from '@/contexts/appAuthContext';
import { useConsent } from '@/hooks/useConsent';
import classes from './styles.module.css';

export function OnboardingConsentGate() {
	const session = useAppAuth();
	const { level, setLevel, status, save } = useConsent(session.loggingConsent);

	return (
		<div className={classes.loginContainer}>
			<h3>Choose your privacy level</h3>
			<p>
				How much this app records about your usage. You can change this
				anytime from Account &amp; privacy.
			</p>
			<ConsentLevelChooser value={level} onChange={setLevel} />
			{status === 'error' ? (
				<p>Could not save your choice. Please try again.</p>
			) : null}
			<Button
				color="primary"
				variant="solid"
				loading={status === 'saving'}
				onClick={() => void save(level)}
			>
				Continue
			</Button>
		</div>
	);
}
