/**
 * Presentational panel for the My Words interaction — caption, scratchpad,
 * the writer's sent lines, a staged proposal's accept/decline, the continuer
 * affordance, and the input row. Pure props in, callbacks out, so the live page
 * and the demo harness render the exact same surface.
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
	sentMessages: string[];
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
		sentMessages,
		input,
		onInputChange,
		onSend,
		onContinue,
		onAccept,
		onReject,
		disabled,
	} = props;

	const blocked = disabled || isThinking;

	return (
		<div className={classes.page}>
			<div className={classes.aiCaption} aria-live="polite">
				<span>{caption}</span>
				{isThinking ? (
					<span className={classes.captionDots} aria-hidden>
						<span />
						<span />
						<span />
					</span>
				) : null}
			</div>

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

			{sentMessages.length > 0 ? (
				<div className={classes.saidList}>
					{sentMessages.map((m, i) => (
						<div key={i} className={classes.said}>
							{m}
						</div>
					))}
				</div>
			) : null}

			{awaiting === 'decision' && pending ? (
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
					disabled={blocked || (!input.trim() && awaiting !== 'continue')}
				>
					<AiOutlineSend size={18} />
				</button>
			</form>
		</div>
	);
}
