/**
 * First-run consent gate, shown right after sign-in while the user has never set a
 * consent level (session.hasSetConsent === false). Reuses the shared
 * ConsentLevelChooser + useConsent so it stays in lockstep with the account page.
 *
 * Continue is the only way out. It saves the current selection (keeping the
 * pre-selected default counts as a choice) and stamps consentUpdatedAt; the saved
 * snapshot flips the session's hasSetConsent, which unmounts this gate. If the
 * save fails, the gate stays up with an error instead of letting the app run with
 * consent unset.
 *
 * There is no Skip. The app, and so all logging, doesn't render until a level is
 * chosen, so nothing is logged before the writer has chosen. A Skip would leave
 * the 'usage' default in force without the writer having picked it.
 */
import { Button } from '@/components/button';
import { ConsentLevelChooser } from '@/components/ConsentLevelChooser';
import { useAppAuth } from '@/contexts/appAuthContext';
import { useConsent } from '@/hooks/useConsent';
import classes from './styles.module.css';

export function OnboardingConsentGate() {
	const session = useAppAuth();
	const { level, setLevel, status, save } = useConsent(
		session.loggingConsent,
	);

	return (
		<div className={classes.consentGate}>
			<h3 className={classes.consentGateTitle}>
				Choose your privacy level
			</h3>
			<p className={classes.consentGateIntro}>
				How much this app records about your usage. You can change this
				anytime from Account &amp; privacy.
			</p>
			{/* Disabled while saving. Continue sends the level selected at that
			    moment, so a different pick made before the reply arrives would show
			    as selected while the server records the first one. The account page
			    does the same. */}
			<ConsentLevelChooser
				value={level}
				onChange={setLevel}
				disabled={status === 'saving'}
			/>
			{status === 'error' ? (
				<p className={classes.consentGateError} role="alert">
					Could not save your choice. Please try again.
				</p>
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
