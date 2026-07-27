/**
 * "Set your brief" — the writer states who this document is for, what they want
 * it to do for them, and what it has to satisfy.
 *
 * The values live on the document (see `contexts/docBriefContext`), so this is
 * a view onto shared state rather than an owner of it: every page renders the
 * same section, an edit made on one is on all of them, and it is still there on
 * the next visit.
 *
 * It collapses because the Google Docs sidebar is ~300px wide and three
 * textareas is most of a screen. Revise, where the brief is step 1 of a
 * deliberate flow, opens it by default; elsewhere it sits as one summary line
 * naming which fields are set, until the writer wants it.
 */
import { useRef, useState } from 'react';
import { AiOutlineRight } from 'react-icons/ai';
import { docBriefLog, type LogPage } from '@/api/logging';
import {
	DOC_BRIEF_FIELDS,
	DOC_BRIEF_LABELS,
	type DocBriefField,
	filledBriefFields,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { useLog } from '@/hooks/useLog';
import classes from './styles.module.css';

/**
 * Second line under each field's title.
 *
 * Each asks about the document and its reader, never about how the assistant
 * should behave — see the note on field choice in `docBriefContext`.
 */
const FIELD_HINTS: Record<DocBriefField, string> = {
	audience: 'Who are you writing this for?',
	purpose: 'What do you want this to do for them?',
	constraints: 'What does this have to satisfy?',
};

const FIELD_PLACEHOLDERS: Record<DocBriefField, string> = {
	audience:
		'e.g. First-year college students with no background in the topic...',
	purpose:
		'e.g. Convince the faculty senate to fund a pilot — they need to see it is low-risk...',
	constraints:
		'e.g. Under 400 words, for the campus newspaper, has to cite the budget report...',
};

export interface BriefSectionProps {
	/** The page rendering it — for attributing edit events. */
	page: LogPage;
	/** Shown in the label's badge on pages that number their steps. */
	step?: number;
	/** Whether to start expanded. Defaults to collapsed. */
	defaultOpen?: boolean;
}

export default function BriefSection({
	page,
	step,
	defaultOpen = false,
}: BriefSectionProps): React.JSX.Element {
	const { brief, setField, status } = useDocBrief();
	const log = useLog();
	const [isOpen, setIsOpen] = useState(defaultOpen);
	/**
	 * What the focused field held when the writer entered it. An event per
	 * keystroke would be noise and an event per blur would count every field
	 * they merely tabbed through, so one is emitted only when the text changed.
	 */
	const valueOnFocusRef = useRef('');

	const filled = filledBriefFields(brief);

	// Collapsed, the header still reports which fields are set, so a writer on
	// Chat or Draft can see a brief is in effect without giving up the space to
	// three textareas they aren't editing.
	const summary =
		status === 'loading'
			? 'Loading…'
			: filled.length === 0
				? 'Not set yet'
				: filled.map((field) => DOC_BRIEF_LABELS[field]).join(' · ');

	return (
		<section className={classes.section}>
			<button
				type="button"
				className={classes.header}
				aria-expanded={isOpen}
				onClick={() => setIsOpen((open) => !open)}
			>
				{step === undefined ? null : (
					<span className={classes.stepBadge}>{step}</span>
				)}
				<span className={classes.title}>Set your brief</span>
				<span className={classes.rule} />
				<span
					className={`${classes.summary} ${filled.length > 0 ? classes.set : ''}`}
				>
					{summary}
				</span>
				<span
					className={`${classes.chevron} ${isOpen ? classes.open : ''}`}
					aria-hidden="true"
				>
					<AiOutlineRight />
				</span>
			</button>

			{isOpen ? (
				<>
					{DOC_BRIEF_FIELDS.map((field) => (
						<div key={field} className={classes.block}>
							<div className={classes.blockHead}>
								<label
									className={classes.blockTitle}
									htmlFor={`brief-${field}`}
								>
									{DOC_BRIEF_LABELS[field]}
								</label>
								<div className={classes.blockHint}>
									{FIELD_HINTS[field]}
								</div>
							</div>
							<textarea
								id={`brief-${field}`}
								className={classes.input}
								rows={2}
								placeholder={FIELD_PLACEHOLDERS[field]}
								// Editing before the stored value has loaded would be
								// typing into something about to be replaced.
								disabled={status === 'loading'}
								value={brief[field]}
								onChange={(e) => setField(field, e.target.value)}
								onFocus={(e) => {
									valueOnFocusRef.current = e.target.value;
								}}
								onBlur={(e) => {
									if (e.target.value === valueOnFocusRef.current) {
										return;
									}
									docBriefLog.fieldEdited(log, page, {
										field,
										hasContent: e.target.value.trim() !== '',
									});
								}}
							/>
						</div>
					))}

					<div
						className={`${classes.statusLine} ${status === 'error' ? classes.error : ''}`}
					>
						{status === 'saving'
							? 'Saving to your document…'
							: status === 'error'
								? "Couldn't save your brief to this document. It will apply to this session only."
								: 'Saved with your document, and used on every page.'}
					</div>
				</>
			) : null}
		</section>
	);
}
