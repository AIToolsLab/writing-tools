/**
 * "Set your to-do" — the writer tells the assistant who the document is for,
 * what it must not touch, and anything else it should know before it runs.
 *
 * The values live on the document (see `contexts/docGoalsContext`), so this is
 * a view onto shared state rather than an owner of it: every page renders the
 * same section, and an edit made on one is on all of them, and still there on
 * the next visit.
 *
 * It collapses because the Google Docs sidebar is ~300px wide and three
 * textareas is most of a screen. Revise, where the to-do is step 1 of a
 * deliberate flow, opens it by default; elsewhere it sits as one summary line
 * until the writer wants it.
 */
import { useRef, useState } from 'react';
import { AiOutlineRight } from 'react-icons/ai';
import { docGoalsLog, type LogPage } from '@/api/logging';
import {
	DOC_GOAL_FIELDS,
	DOC_GOAL_LABELS,
	type DocGoalField,
	filledDocGoalFields,
	useDocGoals,
} from '@/contexts/docGoalsContext';
import { useLog } from '@/hooks/useLog';
import classes from './styles.module.css';

/** Second line under each field's title, telling the writer what to put there. */
const FIELD_HINTS: Record<DocGoalField, string> = {
	audience: 'Who are you writing this for?',
	guardrails: 'What should the AI avoid or preserve?',
	comments: 'Anything else the AI should know before running?',
};

const FIELD_PLACEHOLDERS: Record<DocGoalField, string> = {
	audience:
		'e.g. First-year college students with no background in the topic...',
	guardrails:
		"e.g. Don't change the opening paragraph, keep it under 400 words...",
	comments:
		"e.g. This is a draft for peer review. The argument isn't finished yet so don't flag gaps as errors...",
};

const FIELD_ROWS: Record<DocGoalField, number> = {
	audience: 2,
	guardrails: 2,
	comments: 3,
};

export interface ToDoSectionProps {
	/** The page rendering it — for attributing edit events. */
	page: LogPage;
	/** Shown in the label's badge on pages that number their steps. */
	step?: number;
	/** Whether to start expanded. Defaults to collapsed. */
	defaultOpen?: boolean;
}

export default function ToDoSection({
	page,
	step,
	defaultOpen = false,
}: ToDoSectionProps): React.JSX.Element {
	const { goals, setGoal, status } = useDocGoals();
	const log = useLog();
	const [isOpen, setIsOpen] = useState(defaultOpen);
	/**
	 * What the focused field held when the writer entered it. An event per
	 * keystroke would be noise and an event per blur would count every field
	 * they merely tabbed through, so one is emitted only when the text changed.
	 */
	const valueOnFocusRef = useRef('');

	const filled = filledDocGoalFields(goals);

	// Collapsed, the header still reports which fields are set, so a writer on
	// Chat or Draft can see a to-do is in effect without giving up the space to
	// three textareas they aren't editing.
	const summary =
		status === 'loading'
			? 'Loading…'
			: filled.length === 0
				? 'Not set yet'
				: filled.map((field) => DOC_GOAL_LABELS[field]).join(' · ');

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
				<span className={classes.title}>Set your to-do</span>
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
					{DOC_GOAL_FIELDS.map((field) => (
						<div key={field} className={classes.block}>
							<div className={classes.blockHead}>
								<label
									className={classes.blockTitle}
									htmlFor={`todo-${field}`}
								>
									{DOC_GOAL_LABELS[field]}
								</label>
								<div className={classes.blockHint}>
									{FIELD_HINTS[field]}
								</div>
							</div>
							<textarea
								id={`todo-${field}`}
								className={classes.input}
								rows={FIELD_ROWS[field]}
								placeholder={FIELD_PLACEHOLDERS[field]}
								// Editing before the stored value has loaded would be
								// typing into something about to be replaced.
								disabled={status === 'loading'}
								value={goals[field]}
								onChange={(e) => setGoal(field, e.target.value)}
								onFocus={(e) => {
									valueOnFocusRef.current = e.target.value;
								}}
								onBlur={(e) => {
									if (e.target.value === valueOnFocusRef.current) {
										return;
									}
									docGoalsLog.goalEdited(log, page, {
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
								? "Couldn't save your to-do to this document. It will apply to this session only."
								: 'Saved with your document, and used on every page.'}
					</div>
				</>
			) : null}
		</section>
	);
}
