/**
 * Presentational panel for the My Words interaction.
 *
 * Layout: the writer's words (scratchpad) fill the top and grow; everything
 * conversational lives in one zone at the bottom, next to where they reply — the
 * model's fleeting utterance (or a staged proposal) just above the input.
 *
 * The model's speech is rendered non-selectable: it contributes no words to the
 * document, so the writer shouldn't be able to lift its phrasing. Sent messages
 * aren't shown separately — the page appends them to the scratchpad, since they
 * are part of the writer's word bank too.
 */

import { AiOutlineSend } from 'react-icons/ai';

import classes from './styles.module.css';
import type { Awaiting, PendingProposal } from './interaction/types';

export interface InteractionPanelProps {
	caption: string;
	isThinking: boolean;
	awaiting: Awaiting;
	pending: PendingProposal | null;
	scratchpad: string;
	onScratchpadChange: (v: string) => void;
	input: string;
	onInputChange: (v: string) => void;
	onSend: () => void;
	onContinue: () => void;
	onAccept: () => void;
	onReject: () => void;
	/** Disable controls (e.g. while a demo plays itself). */
	disabled?: boolean;
}

export function InteractionPanel(props: InteractionPanelProps) {
	const {
		caption,
		isThinking,
		awaiting,
		pending,
		scratchpad,
		onScratchpadChange,
		input,
		onInputChange,
		onSend,
		onContinue,
		onAccept,
		onReject,
		disabled,
	} = props;

	const blocked = disabled || isThinking;
	const showProposal = awaiting === 'decision' && pending;

	return (
		<div className={classes.page}>
			<label className={classes.scratchLabel} htmlFor="mywords-scratchpad">
				Your words — scratchpad
			</label>
			<textarea
				id="mywords-scratchpad"
				className={classes.scratchpad}
				placeholder="Brain-dump here in your own words. The AI can only build the document out of what you write or say."
				value={scratchpad}
				disabled={disabled}
				onChange={(e) => onScratchpadChange(e.target.value)}
			/>

			<div className={classes.exchange}>
				{/* The model's speech: fleeting and non-selectable. When a proposal
				    is staged the card below carries its words instead. */}
				{!showProposal ? (
					<div className={classes.aiUtterance} aria-live="polite">
						<span className={classes.aiUtteranceText}>{caption}</span>
						{isThinking ? (
							<span className={classes.captionDots} aria-hidden>
								<span />
								<span />
								<span />
							</span>
						) : null}
					</div>
				) : null}

				{showProposal ? (
					<div className={classes.proposal}>
						<div className={classes.proposalSay}>{pending.say}</div>
						<div className={classes.proposalSummary}>
							{pending.summary}
							<span className={classes.proposalWhere}>
								{' '}— highlighted in your document
							</span>
						</div>
						<div className={classes.proposalActions}>
							<button
								type="button"
								className={classes.accept}
								disabled={blocked}
								onClick={onAccept}
							>
								Accept
							</button>
							<button
								type="button"
								className={classes.reject}
								disabled={blocked}
								onClick={onReject}
							>
								Not yet
							</button>
						</div>
					</div>
				) : null}

				{awaiting === 'continue' ? (
					<div className={classes.continueHint}>
						Press Enter to let it make the next move — or type to steer.
					</div>
				) : null}

				<form
					className={classes.inputRow}
					onSubmit={(e) => {
						e.preventDefault();
						if (blocked) return;
						if (input.trim()) onSend();
						else if (awaiting === 'continue') onContinue();
					}}
				>
					<textarea
						className={classes.input}
						placeholder={
							awaiting === 'continue'
								? 'Enter to continue, or say what to do instead…'
								: 'Say what you want to do…'
						}
						value={input}
						rows={1}
						disabled={blocked}
						onChange={(e) => onInputChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
					/>
					<button
						type="submit"
						className={classes.sendBtn}
						title="Send"
						disabled={
							blocked || (!input.trim() && awaiting !== 'continue')
						}
					>
						<AiOutlineSend size={18} />
					</button>
				</form>
			</div>
		</div>
	);
}
