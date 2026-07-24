/**
 * Shared logging-consent chooser, used by the account page and (later) the
 * onboarding consent step.
 *
 * Choice architecture — no dark patterns:
 *   - every level is a plain radio of equal visual weight (styling in the CSS
 *     module deliberately does not emphasise the higher-collection options);
 *   - descriptions come verbatim from CONSENT_LEVEL_LABELS (plain language);
 *   - nothing is pre-checked here — the caller supplies `value`, and is
 *     responsible for defaulting to the privacy-protective option;
 *   - `document` ("full study logging") is hidden unless `allowStudyLevel`, so a
 *     user can't opt into study logging outside the explicit study flow. It remains
 *     visible when it is the current value, so an existing participant can see and
 *     lower their actual setting.
 */
import {
	CONSENT_LEVELS,
	CONSENT_LEVEL_LABELS,
	type ConsentLevel,
} from '@/consent';
import classes from './ConsentLevelChooser.module.css';

/** The study-only level, gated behind an explicit study opt-in. */
const STUDY_LEVEL: ConsentLevel = 'document';

export interface ConsentLevelChooserProps {
	value: ConsentLevel;
	onChange: (level: ConsentLevel) => void;
	/** Offer the `document` (full study logging) level. Default: false. */
	allowStudyLevel?: boolean;
	/** Disable all inputs (e.g. while a change is saving). */
	disabled?: boolean;
	/** Radio group name — unique it if two choosers ever share a page. */
	name?: string;
}

export function ConsentLevelChooser({
	value,
	onChange,
	allowStudyLevel = false,
	disabled = false,
	name = 'loggingConsent',
}: ConsentLevelChooserProps) {
	const levels = CONSENT_LEVELS.filter(
		(level) =>
			allowStudyLevel || level !== STUDY_LEVEL || value === STUDY_LEVEL,
	);

	return (
		<fieldset
			className={classes.group}
			disabled={disabled}
			aria-label="Logging level"
		>
			{levels.map((level) => {
				const { title, description } = CONSENT_LEVEL_LABELS[level];
				const id = `${name}-${level}`;
				return (
					<label key={level} htmlFor={id} className={classes.option}>
						<input
							type="radio"
							id={id}
							name={name}
							value={level}
							checked={value === level}
							onChange={() => onChange(level)}
							className={classes.radio}
						/>
						<span className={classes.text}>
							<span className={classes.title}>{title}</span>
							<span className={classes.description}>
								{description}
							</span>
						</span>
					</label>
				);
			})}
		</fieldset>
	);
}
