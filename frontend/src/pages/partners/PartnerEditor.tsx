/**
 * The partner configuration panel (paper §4.1, Fig. 3): name + emoji, role,
 * event triggers, contextual heuristic.
 *
 * Two details are deliberately the paper's rather than better UI:
 *
 * - **No trigger is selected by default.** The paper says so explicitly, "to
 *   avoid anchoring effects" — a pre-selected trigger would be telling the
 *   writer when they ought to want help.
 * - **Role and heuristic are separate fields**, even though a writer could put
 *   both in one box. Keeping them apart is what makes the study legible: the
 *   role is what kind of help, the heuristic is the condition under which the
 *   help is worth an interruption, and the paper's findings turn on writers
 *   treating those as different questions.
 */
import { useState } from 'react';
import { AiOutlineDelete, AiOutlinePlus } from 'react-icons/ai';
import {
	EVENT_TRIGGERS,
	TRIGGER_HINTS,
	TRIGGER_LABELS,
	type EventTrigger,
	type Partner,
} from './types';
import { emptyPartner, isPartnerActivatable } from './storage';
import classes from './styles.module.css';

export interface PartnerEditorProps {
	partners: Partner[];
	onChange: (partners: Partner[]) => void;
	onConfigured: (
		action: 'created' | 'updated' | 'deleted' | 'enabled' | 'disabled',
		partner: Partner,
	) => void;
}

export default function PartnerEditor({
	partners,
	onChange,
	onConfigured,
}: PartnerEditorProps): React.JSX.Element {
	// Which partner is expanded for editing. A newly added one opens itself.
	const [openId, setOpenId] = useState<string | null>(null);

	function update(partner: Partner, patch: Partial<Partner>): void {
		const updated = { ...partner, ...patch };
		onChange(partners.map((p) => (p.id === partner.id ? updated : p)));
		return;
	}

	function add(): void {
		const partner = emptyPartner();
		onChange([...partners, partner]);
		setOpenId(partner.id);
		onConfigured('created', partner);
	}

	function remove(partner: Partner): void {
		onChange(partners.filter((p) => p.id !== partner.id));
		onConfigured('deleted', partner);
	}

	function toggleTrigger(partner: Partner, trigger: EventTrigger): void {
		const triggers = partner.triggers.includes(trigger)
			? partner.triggers.filter((t) => t !== trigger)
			: [...partner.triggers, trigger];
		update(partner, { triggers });
	}

	return (
		<div className={classes.editor}>
			{partners.length === 0 && (
				<p className={classes.empty}>
					No partners yet. A partner is a kind of help you want, plus
					the moment you want it — nothing happens until you describe
					both.
				</p>
			)}

			<ul className={classes.partnerList}>
				{partners.map((partner) => {
					const isOpen = openId === partner.id;
					const ready = isPartnerActivatable(partner);
					return (
						<li key={partner.id} className={classes.partner}>
							<div className={classes.partnerHeader}>
								<input
									className={classes.emojiInput}
									value={partner.emoji}
									maxLength={4}
									aria-label="Partner emoji"
									onChange={(e) =>
										update(partner, {
											emoji: e.target.value || '💭',
										})
									}
								/>
								<input
									className={classes.nameInput}
									value={partner.name}
									placeholder="Name (e.g. Evidence Partner)"
									aria-label="Partner name"
									onChange={(e) =>
										update(partner, {
											name: e.target.value,
										})
									}
									onBlur={() =>
										onConfigured('updated', partner)
									}
								/>
								<label className={classes.enableToggle}>
									<input
										type="checkbox"
										checked={partner.enabled}
										onChange={(e) => {
											update(partner, {
												enabled: e.target.checked,
											});
											onConfigured(
												e.target.checked
													? 'enabled'
													: 'disabled',
												partner,
											);
										}}
									/>
									<span className={classes.visuallyHidden}>
										Enable {partner.name || 'partner'}
									</span>
								</label>
								<button
									type="button"
									className={classes.iconButton}
									aria-label={`Delete ${partner.name || 'partner'}`}
									onClick={() => remove(partner)}
								>
									<AiOutlineDelete />
								</button>
							</div>

							<button
								type="button"
								className={classes.disclosure}
								aria-expanded={isOpen}
								onClick={() =>
									setOpenId(isOpen ? null : partner.id)
								}
							>
								{isOpen ? 'Hide details' : 'Edit details'}
								{!ready && (
									<span className={classes.incomplete}>
										{' '}
										· not yet active
									</span>
								)}
							</button>

							{isOpen ? (
								<div className={classes.partnerBody}>
									<label className={classes.field}>
										<span className={classes.fieldLabel}>
											What kind of help?
										</span>
										<textarea
											className={classes.textarea}
											rows={3}
											value={partner.role}
											placeholder="e.g. Notice when I assert something without support, and help me think about what evidence would actually convince this reader."
											onChange={(e) =>
												update(partner, {
													role: e.target.value,
												})
											}
											onBlur={() =>
												onConfigured('updated', partner)
											}
										/>
									</label>

									<fieldset className={classes.field}>
										<legend className={classes.fieldLabel}>
											When may it consider stepping in?
										</legend>
										{EVENT_TRIGGERS.map((trigger) => (
											<label
												key={trigger}
												className={classes.checkRow}
											>
												<input
													type="checkbox"
													checked={partner.triggers.includes(
														trigger,
													)}
													onChange={() => {
														toggleTrigger(
															partner,
															trigger,
														);
														onConfigured(
															'updated',
															partner,
														);
													}}
												/>
												<span>
													<strong>
														{
															TRIGGER_LABELS[
																trigger
															]
														}
													</strong>
													<br />
													<span
														className={
															classes.checkHint
														}
													>
														{TRIGGER_HINTS[trigger]}
													</span>
												</span>
											</label>
										))}
									</fieldset>

									<label className={classes.field}>
										<span className={classes.fieldLabel}>
											…and only when what is true?
										</span>
										<textarea
											className={classes.textarea}
											rows={3}
											value={partner.heuristic}
											placeholder="e.g. When I have just made a claim and there is no example or citation near it."
											onChange={(e) =>
												update(partner, {
													heuristic: e.target.value,
												})
											}
											onBlur={() =>
												onConfigured('updated', partner)
											}
										/>
										<span className={classes.fieldHint}>
											This is the condition the system
											checks before interrupting. The
											narrower it is, the less often you
											will be interrupted.
										</span>
									</label>
								</div>
							) : null}
						</li>
					);
				})}
			</ul>

			<button type="button" className={classes.addButton} onClick={add}>
				<AiOutlinePlus /> Add a partner
			</button>
		</div>
	);
}
