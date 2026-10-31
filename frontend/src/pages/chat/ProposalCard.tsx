import { useState } from 'react';

import type { AppliedEdit } from '@/contexts/chatContext';
import { isEditToolName, toEditOp } from '@/docTools/editTools';
import { describeOp } from '@/docTools/ops';
import type { ChangePreview } from '@/docTools/preview';

import classes from './proposalCard.module.css';
import type { ProposalItem } from './transcript';

function Preview({ preview, full }: { preview: ChangePreview; full: boolean }) {
	if (full) {
		return (
			<div className={classes.preview}>
				{preview.fullOld ? (
					<del className={classes.removed}>{preview.fullOld}</del>
				) : null}
				{preview.fullNew ? (
					<ins className={classes.added}>{preview.fullNew}</ins>
				) : null}
			</div>
		);
	}
	return (
		<div className={classes.preview}>
			{preview.clippedBefore ? '…' : ''}
			{preview.before}
			{preview.removed ? (
				<del className={classes.removed}>{preview.removed}</del>
			) : null}
			{preview.added ? (
				<ins className={classes.added}>{preview.added}</ins>
			) : null}
			{preview.after}
			{preview.clippedAfter ? '…' : ''}
		</div>
	);
}

const STATUS_LABEL: Record<Exclude<ProposalItem['status'], 'pending'>, string> =
	{
		applying: 'Applying…',
		applied: 'Applied',
		failed: 'Couldn’t apply',
		declined: 'Declined',
		'set-aside': 'Set aside',
	};

/**
 * A proposed edit in the transcript. Pending: what would change, and Accept /
 * Decline. Afterwards: one status line, with Undo for an applied edit.
 */
export function ProposalCard({
	proposal,
	previews,
	applied,
	undoError,
	busy,
	onAccept,
	onDecline,
	onUndo,
}: {
	proposal: ProposalItem;
	/** Trimmed previews against the current document; pending cards only. */
	previews: ChangePreview[] | null;
	applied: AppliedEdit | undefined;
	undoError: string | undefined;
	busy: boolean;
	onAccept: () => void;
	onDecline: () => void;
	onUndo: () => void;
}) {
	const [full, setFull] = useState(false);
	const summary = isEditToolName(proposal.toolName)
		? describeOp(toEditOp(proposal.toolName, proposal.input))
		: proposal.toolName;

	if (proposal.status !== 'pending') {
		return (
			<div className={classes.settled}>
				<span>
					{applied?.undone ? 'Undone' : STATUS_LABEL[proposal.status]}:{' '}
					{summary}
				</span>
				{proposal.status === 'applied' && applied && !applied.undone ? (
					<button
						type="button"
						className={classes.linkButton}
						disabled={busy}
						onClick={onUndo}
					>
						Undo
					</button>
				) : null}
				{undoError ? (
					<div className={classes.undoError}>{undoError}</div>
				) : null}
			</div>
		);
	}

	return (
		<div className={classes.card}>
			<div className={classes.summary}>{summary}</div>
			{previews?.map((preview, i) => (
				<Preview key={i} preview={preview} full={full} />
			))}
			{previews?.some((p) => p.clippedBefore || p.clippedAfter) ? (
				<button
					type="button"
					className={classes.linkButton}
					onClick={() => setFull(!full)}
				>
					{full ? 'Show less' : 'Show whole passage'}
				</button>
			) : null}
			<div className={classes.actions}>
				<button
					type="button"
					className={classes.accept}
					disabled={busy}
					onClick={onAccept}
				>
					Accept
				</button>
				<button
					type="button"
					className={classes.decline}
					disabled={busy}
					onClick={onDecline}
				>
					Decline
				</button>
			</div>
		</div>
	);
}
