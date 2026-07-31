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
 *
 * ## Drafting from the document
 *
 * A blank brief is the common case, and the writer has already written the
 * evidence for it — the draft. "Draft from my document" asks for candidate
 * wording per field (`api/briefProposal`) and renders each one as a provisional
 * card the writer keeps or throws away. Nothing a candidate says reaches the
 * document until they press Use this; see `docs/design/co-created-brief.md`.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { AiOutlineRight } from 'react-icons/ai';
import { requestBriefProposal } from '@/api/briefProposal';
import {
	describeGenerationError,
	type GenerationErrorInfo,
} from '@/api/errors';
import { docBriefLog, type LogPage } from '@/api/logging';
import { ErrorNotice, GenerationErrorNotice } from '@/components/errorNotice';
import {
	DOC_BRIEF_FIELDS,
	DOC_BRIEF_LABELS,
	type DocBriefField,
	filledBriefFields,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
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

/**
 * What the last "draft from my document" run produced, beyond the candidates
 * themselves (which live in the shared context so they survive collapsing the
 * section). `empty` and `emptyDoc` are outcomes the writer has to see: a run
 * that quietly changes nothing reads as a broken button.
 */
type ProposalRun =
	| { kind: 'idle' }
	| { kind: 'running' }
	| { kind: 'error'; info: GenerationErrorInfo }
	| { kind: 'empty' }
	| { kind: 'emptyDoc' };

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
	const {
		brief,
		setField,
		status,
		proposals,
		setProposals,
		acceptProposal,
		dismissProposal,
	} = useDocBrief();
	const editorAPI = useContext(EditorContext);
	const log = useLog();
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const [run, setRun] = useState<ProposalRun>({ kind: 'idle' });
	/**
	 * What the focused field held when the writer entered it. An event per
	 * keystroke would be noise and an event per blur would count every field
	 * they merely tabbed through, so one is emitted only when the text changed.
	 */
	const valueOnFocusRef = useRef('');
	const proposalControllerRef = useRef<AbortController | null>(null);
	/**
	 * Read at request time rather than tracked, so the request always uses the
	 * brief as it stands without rebuilding the handler on every keystroke.
	 */
	const briefRef = useRef(brief);
	briefRef.current = brief;

	useEffect(() => {
		return () => {
			// Stop an in-flight proposal so it can't set state after unmount.
			proposalControllerRef.current?.abort();
		};
	}, []);

	const filled = filledBriefFields(brief);

	async function draftFromDocument() {
		proposalControllerRef.current?.abort();
		const controller = new AbortController();
		proposalControllerRef.current = controller;

		setRun({ kind: 'running' });

		try {
			// Pulled here rather than tracked continuously: on the Google Docs
			// surface reading the document is an Apps Script round-trip, and the
			// page already holds its own copy for its own requests.
			const docContext = await editorAPI.getDocContext();

			if (
				docContext.beforeCursor.length === 0 &&
				docContext.selectedText.length === 0 &&
				docContext.afterCursor.length === 0
			) {
				setRun({ kind: 'emptyDoc' });
				return;
			}

			docBriefLog.proposalRequested(log, page, { docContext });

			const proposed = await requestBriefProposal({
				docContext,
				brief: briefRef.current,
				abortSignal: controller.signal,
			});

			const fields = Object.keys(proposed);
			docBriefLog.proposalReceived(log, page, {
				fields,
				result: JSON.stringify(proposed),
			});

			setProposals(proposed);
			setRun(fields.length === 0 ? { kind: 'empty' } : { kind: 'idle' });
		} catch (error) {
			if (controller.signal.aborted) return;
			const info = describeGenerationError(error);
			console.error('Could not draft a brief from the document:', error);
			setRun({ kind: 'error', info });
			docBriefLog.proposalError(log, page, {
				error: info.detail,
				code: info.code,
			});
		} finally {
			if (proposalControllerRef.current === controller) {
				proposalControllerRef.current = null;
			}
		}
	}

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
					<div className={classes.draftRow}>
						<span className={classes.draftHint}>
							Not sure yet? Your draft already says a lot of this.
						</span>
						<button
							type="button"
							className={classes.draftBtn}
							disabled={
								status === 'loading' || run.kind === 'running'
							}
							onClick={() => {
								void draftFromDocument();
							}}
						>
							{run.kind === 'running'
								? 'Reading your draft…'
								: 'Draft from my document'}
						</button>
					</div>

					{DOC_BRIEF_FIELDS.map((field) => {
						const proposal = proposals[field];
						return (
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
									onChange={(e) =>
										setField(field, e.target.value)
									}
									onFocus={(e) => {
										valueOnFocusRef.current =
											e.target.value;
									}}
									onBlur={(e) => {
										if (
											e.target.value ===
											valueOnFocusRef.current
										) {
											return;
										}
										docBriefLog.fieldEdited(log, page, {
											field,
											hasContent:
												e.target.value.trim() !== '',
										});
									}}
								/>

								{/*
								 * A candidate, not the writer's text. It sits below
								 * the field rather than inside it so their own
								 * wording is never displaced by something they
								 * haven't agreed to — including when the field is
								 * already filled and this is only a sharper version.
								 */}
								{proposal === undefined ? null : (
									<div className={classes.proposal}>
										<div className={classes.proposalLabel}>
											Suggested from your draft — yours to
											edit
										</div>
										<div className={classes.proposalText}>
											{proposal}
										</div>
										<div
											className={classes.proposalActions}
										>
											<button
												type="button"
												className={classes.proposalUse}
												onClick={() => {
													acceptProposal(field);
													docBriefLog.proposalResolved(
														log,
														page,
														{
															field,
															action: 'accepted',
														},
													);
												}}
											>
												Use this
											</button>
											<button
												type="button"
												className={
													classes.proposalDismiss
												}
												onClick={() => {
													dismissProposal(field);
													docBriefLog.proposalResolved(
														log,
														page,
														{
															field,
															action: 'dismissed',
														},
													);
												}}
											>
												Dismiss
											</button>
										</div>
									</div>
								)}
							</div>
						);
					})}

					{run.kind === 'error' ? (
						<GenerationErrorNotice
							info={run.info}
							title="Couldn't draft from your document"
							onRetry={() => {
								void draftFromDocument();
							}}
						/>
					) : null}
					{run.kind === 'empty' ? (
						<ErrorNotice
							tone="info"
							title="Nothing to suggest yet"
							message="The draft didn't settle who this is for or what it has to do. That's worth writing down yourself — it's the part the document can't tell us."
						/>
					) : null}
					{run.kind === 'emptyDoc' ? (
						<ErrorNotice
							tone="info"
							title="Nothing to read yet"
							message="Write something first, and this can draft a brief from it."
						/>
					) : null}

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
