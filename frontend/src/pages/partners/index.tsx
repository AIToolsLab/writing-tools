/**
 * Partners — a reproduction of Zhang, Davis, Chen & Hsu, *Designing Proactive
 * Thought Partners for Writing* (arXiv:2609.01588v1), as a lab page.
 *
 * The writer configures partners (what help, when, and under what condition);
 * while watching is on, the page polls the document, detects the paper's three
 * event triggers, asks a decision engine whether any partner's condition is
 * satisfied, and shows the ones that are as small tags. Clicking a tag opens
 * the suggestion. Ignoring it lets it fade.
 *
 * `docs/proactive-partners-reproduction.md` is the map from the paper to this
 * file, and the running log of where the reproduction had to give ground —
 * most of it because a task pane cannot see keystrokes, cannot know where the
 * cursor is on screen, and does not rewrite the writer's prose.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { describeGenerationError } from '@/api/errors';
import { partnersLog } from '@/api/logging';
import BriefSection from '@/components/briefSection';
import {
	formatDocBriefForPrompt,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import { useLog } from '@/hooks/useLog';
import PartnerEditor from './PartnerEditor';
import SuggestionCard from './SuggestionCard';
import {
	PARTNERS_SETTING_KEY,
	activeTriggers,
	isPartnerActivatable,
	parsePartners,
	serializePartners,
} from './storage';
import { usePartnerWatch } from './usePartnerWatch';
import type { Activation, Partner } from './types';
import { TRIGGER_LABELS } from './types';
import classes from './styles.module.css';

/** Debounce before writing partners into the document, as the brief does. */
const SAVE_DEBOUNCE_MS = 600;

export default function Partners(): React.JSX.Element {
	const editorAPI = useContext(EditorContext);
	const { brief } = useDocBrief();
	const log = useLog();

	const [partners, setPartners] = useState<Partner[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [watching, setWatching] = useState(false);
	/** The activation whose card is open, if any. */
	const [openActivation, setOpenActivation] = useState<Activation | null>(
		null,
	);

	const briefRef = useRef(brief);
	briefRef.current = brief;
	const promptBrief = formatDocBriefForPrompt(brief);

	// Load the writer's partners from the document once.
	useEffect(() => {
		let cancelled = false;
		editorAPI
			.getDocumentSetting(PARTNERS_SETTING_KEY)
			.then((raw) => {
				if (cancelled) return;
				setPartners(parsePartners(raw));
			})
			.catch((error: unknown) => {
				console.warn('partners: could not load configuration', error);
			})
			.finally(() => {
				if (!cancelled) setLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, [editorAPI]);

	// Save back, debounced. Skipped until the first load settles, or an empty
	// initial state would overwrite the partners already in the document.
	useEffect(() => {
		if (!loaded) return;
		const timer = setTimeout(() => {
			editorAPI
				.setDocumentSetting(
					PARTNERS_SETTING_KEY,
					serializePartners(partners),
				)
				.catch((error: unknown) => {
					console.warn(
						'partners: could not save configuration',
						error,
					);
				});
		}, SAVE_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [partners, loaded, editorAPI]);

	const { activations, deciding, remove, pin } = usePartnerWatch({
		editorAPI,
		partners,
		brief: promptBrief,
		watching,
		onTrigger: (event, candidates) => {
			void partnersLog.triggerFired(log, {
				trigger: event.trigger,
				candidates,
				charsInWindow: event.activity.reduce(
					(sum, record) => sum + Math.abs(record.charsDelta),
					0,
				),
			});
		},
		onActivate: (chosen, event) => {
			void partnersLog.partnersActivated(log, {
				trigger: event.trigger,
				candidates: activeCandidateCount(partners, event.trigger),
				activated: chosen.length,
				latencyMs: Date.now() - event.at,
			});
		},
		onDecisionError: (error) => {
			const info = describeGenerationError(error);
			void partnersLog.generationError(log, {
				stage: 'decision',
				error: info.detail ?? info.message,
				code: info.code,
			});
		},
	});

	// A tag that disappears without being opened is the paper's "Ignoring", and
	// is worth a log line of its own: it is the outcome the study is mostly
	// measuring. Watch the live list and record what left it unopened.
	const previousIds = useRef<Map<string, Activation>>(new Map());
	useEffect(() => {
		const current = new Map(activations.map((a) => [a.id, a]));
		for (const [id, activation] of previousIds.current) {
			if (current.has(id)) continue;
			if (openActivation?.id === id) continue;
			void partnersLog.activationIgnored(log, {
				trigger: activation.trigger,
			});
		}
		previousIds.current = current;
	}, [activations, openActivation, log]);

	const byId = new Map(partners.map((partner) => [partner.id, partner]));
	const readyCount = partners.filter(isPartnerActivatable).length;
	const watched = [...activeTriggers(partners)];

	function openTag(activation: Activation): void {
		pin(activation.id);
		setOpenActivation(activation);
		void partnersLog.activationOpened(log, {
			trigger: activation.trigger,
			ageMs: Date.now() - activation.at,
			docContext: activation.snapshot.beforeCursor.slice(-500),
		});
	}

	function closeCard(): void {
		if (!openActivation) return;
		void partnersLog.activationDismissed(log, {
			trigger: openActivation.trigger,
			opened: true,
		});
		remove(openActivation.id);
		setOpenActivation(null);
	}

	return (
		<div className={classes.container}>
			<p className={classes.intro}>
				Partners watch while you write and speak up only when a
				condition <em>you</em> wrote is met. Most of the time they
				should say nothing.
			</p>

			<BriefSection page="partners" />

			<section className={classes.watchSection}>
				<label className={classes.watchToggle}>
					<input
						type="checkbox"
						checked={watching}
						disabled={readyCount === 0}
						onChange={(e) => {
							setWatching(e.target.checked);
							void partnersLog.watchToggled(log, {
								watching: e.target.checked,
								partners: readyCount,
							});
						}}
					/>
					<span>
						<strong>Watch while I write</strong>
						<br />
						<span className={classes.watchHint}>
							{readyCount === 0
								? 'Add a partner below first.'
								: watching
									? `${readyCount} partner${readyCount === 1 ? '' : 's'} watching for: ${watched
											.map((t) =>
												TRIGGER_LABELS[t].toLowerCase(),
											)
											.join(', ')}.`
									: `${readyCount} partner${readyCount === 1 ? '' : 's'} ready.`}
						</span>
					</span>
				</label>

				{watching ? (
					<p className={classes.privacyNote}>
						While this is on, the add-in reads your document every
						few seconds to notice pauses and selections. Switch it
						off and it stops.
					</p>
				) : null}
			</section>

			{watching ? (
				<section
					className={classes.tagStrip}
					aria-live="polite"
					aria-label="Partners with something to say"
				>
					{deciding && activations.length === 0 ? (
						<span className={classes.deciding}>…</span>
					) : null}
					{activations.map((activation) => {
						const partner = byId.get(activation.partnerId);
						if (!partner) return null;
						const isOpen = openActivation?.id === activation.id;
						return (
							<button
								key={activation.id}
								type="button"
								className={
									isOpen
										? `${classes.tag} ${classes.tagOpen}`
										: classes.tag
								}
								onClick={() => openTag(activation)}
							>
								<span aria-hidden>{partner.emoji}</span>{' '}
								{partner.name}
							</button>
						);
					})}
				</section>
			) : null}

			{openActivation && byId.has(openActivation.partnerId) ? (
				<SuggestionCard
					key={openActivation.id}
					activation={openActivation}
					partner={byId.get(openActivation.partnerId)!}
					brief={promptBrief}
					onDismiss={closeCard}
					onSuggestion={(suggestion, latencyMs) => {
						void partnersLog.suggestionGenerated(log, {
							trigger: openActivation.trigger,
							latencyMs,
							response: `${suggestion.acknowledgement}\n${suggestion.question}`,
						});
					}}
					onFollowUp={(message, turn) => {
						void partnersLog.followUpSent(log, { message, turn });
					}}
					onError={(stage, error) => {
						const info = describeGenerationError(error);
						void partnersLog.generationError(log, {
							stage,
							error: info.detail ?? info.message,
							code: info.code,
						});
					}}
				/>
			) : null}

			<section className={classes.configSection}>
				<h2 className={classes.heading}>Your partners</h2>
				<PartnerEditor
					partners={partners}
					onChange={setPartners}
					onConfigured={(action, partner) => {
						void partnersLog.partnerConfigured(log, {
							action,
							triggers: partner.triggers,
							hasRole: partner.role.trim() !== '',
							hasHeuristic: partner.heuristic.trim() !== '',
						});
					}}
				/>
			</section>

			<p className={classes.provenance}>
				A reproduction of{' '}
				<em>Designing Proactive Thought Partners for Writing</em>{' '}
				(arXiv:2609.01588). One part of the paper is deliberately not
				built: its partners can write into the document, and these
				cannot. See <code>docs/proactive-partners-reproduction.md</code>
				.
			</p>
		</div>
	);
}

/** How many partners were eligible for a trigger, for the activation log. */
function activeCandidateCount(
	partners: Partner[],
	trigger: Activation['trigger'],
): number {
	return partners.filter(
		(partner) =>
			isPartnerActivatable(partner) && partner.triggers.includes(trigger),
	).length;
}
