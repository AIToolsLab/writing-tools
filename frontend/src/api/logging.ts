/**
 * Frontend event logging.
 *
 * Every user-facing page (Draft, Revise, Chat) records interaction events
 * through the helpers in this module so that the study logs share one
 * consistent schema. Each event is written as:
 *
 *   { schema_version, page, event, timestamp, ...data }
 *
 * - `schema_version` lets log readers tell newer events from older ones. Bump
 *   {@link LOG_SCHEMA_VERSION} whenever the envelope or an event payload changes
 *   shape in a way a reader must branch on. Events written before this module
 *   existed have no `schema_version` field at all; readers should treat those
 *   as version 0 (the ad-hoc, pre-schema events).
 * - `page` scopes every event to the page that emitted it, so events can be
 *   filtered per page without parsing the event name.
 * - `event` is a snake_case, verb-phrase name that is unique within its page.
 *
 * Transport, identity, and consent are owned by {@link useLog} (see
 * `@/hooks/useLog`): the server derives the user from the session, and content
 * fields are stripped to the user's consent level. Each page calls `useLog()`
 * once and passes the resulting {@link LogFn} to these helpers. Content-bearing
 * payload fields must use names the consent gate recognizes (see
 * `@/consent` `KEY_MIN_LEVEL`): `docContext`/`message`/`target` are document
 * text, `result`/`response` are AI output; everything else is usage metadata.
 *
 * Event names and payload shapes are declared once here (never inline at call
 * sites) so the naming convention stays consistent and payloads are type
 * checked. To add an event, add a method to the relevant page's helper object.
 */
import type { LogFn } from '@/hooks/useLog';

/**
 * Version of the frontend event-log schema. Bump when the envelope or any event
 * payload changes shape in a way log readers must branch on.
 *
 * History:
 *   1 — Initial page-scoped schema (Draft / Revise / Chat).
 *   2 — Added the Tools page (external tool launcher) and its events.
 *   3 — Error events carry an optional `code` (the provider's error code, e.g.
 *       `insufficient_quota`), and their `error` field now holds the provider's
 *       message rather than the sentence shown to the user.
 *   4 — Added the document-scoped brief (audience / purpose / constraints) and
 *       its `brief_edited` event, which any page can emit. Revise emits
 *       `reference_resolved` after each clicked doctext link, recording whether
 *       the quote was found and how long the search took.
 *   5 — `reference_clicked` / `reference_resolved` are no longer Revise-only:
 *       Chat renders doctext citations too, so `page` is now what says where a
 *       reference event came from. A reader that took those event names to mean
 *       Revise has to read `page` instead.
 *   6 — Added the Partners lab page (the proactive-thought-partners probe) and
 *       its events. Its events are the only ones the writer did not initiate,
 *       so a reader counting "requests" per session must exclude
 *       `trigger_fired` / `partners_activated`, which the system emits on its
 *       own while the writer is typing.
 */
export const LOG_SCHEMA_VERSION = 6;

/** Pages that emit events. Matches the user-facing tabs. */
export type LogPage = 'draft' | 'revise' | 'chat' | 'tools' | 'partners';

/**
 * Emit one event through the page's {@link LogFn}, stamping the schema version,
 * page, and event name. The single place the envelope is assembled.
 */
function emit(
	log: LogFn,
	page: LogPage,
	event: string,
	data: Record<string, unknown> = {},
): Promise<void> {
	return log({ schema_version: LOG_SCHEMA_VERSION, page, event, ...data });
}

/**
 * Draft page: the writer requests short next-step suggestions for a chosen mode
 * (examples, questions, advice, rewording) and can save or delete them.
 */
export const draftLog = {
	/** A suggestion mode button was clicked. */
	suggestionRequested(
		log: LogFn,
		data: { generationType: string; docContext: DocContext },
	) {
		return emit(log, 'draft', 'suggestion_requested', data);
	},
	/** A generated suggestion was shown to (and saved for) the writer. */
	suggestionShown(
		log: LogFn,
		data: {
			generationType: string;
			docContext: DocContext;
			result: GenerationResult;
		},
	) {
		return emit(log, 'draft', 'suggestion_shown', data);
	},
	/** The writer deleted a saved suggestion. */
	suggestionDeleted(
		log: LogFn,
		data: {
			generationType: string;
			docContext: DocContext;
			result: GenerationResult;
		},
	) {
		return emit(log, 'draft', 'suggestion_deleted', data);
	},
	/** The model returned an empty suggestion, so nothing was shown. */
	suggestionEmpty(
		log: LogFn,
		data: { generationType: string; docContext: DocContext },
	) {
		return emit(log, 'draft', 'suggestion_empty', data);
	},
	/** A suggestion request failed (timeout or model error). */
	generationError(
		log: LogFn,
		data: {
			generationType: string;
			docContext: DocContext;
			error: string;
			code?: string;
		},
	) {
		return emit(log, 'draft', 'generation_error', data);
	},
	/** An automatic (non-user-initiated) refresh fired. */
	autoRefresh(
		log: LogFn,
		data: { generationType: string; docContext: DocContext },
	) {
		return emit(log, 'draft', 'auto_refresh', data);
	},
};

/**
 * Revise page: the writer picks "features" (visualizations of their document)
 * and runs them, then can click document references in the results.
 */
export const reviseLog = {
	/** A feature checkbox was toggled on or off. */
	featureToggled(log: LogFn, data: { feature: string; selected: boolean }) {
		return emit(log, 'revise', 'feature_toggled', data);
	},
	/** The "Run" button was pressed for the current set of selected features. */
	featuresRun(log: LogFn, data: { features: string[] }) {
		return emit(log, 'revise', 'features_run', data);
	},
	/** A single feature's visualization request started streaming. */
	visualizationRequested(
		log: LogFn,
		data: { feature: string; isOverall: boolean; docContext: DocContext },
	) {
		return emit(log, 'revise', 'visualization_requested', data);
	},
	/** A visualization finished streaming successfully. */
	visualizationCompleted(
		log: LogFn,
		data: { feature: string; response: string },
	) {
		return emit(log, 'revise', 'visualization_completed', data);
	},
	/** A visualization request failed (and was not merely cancelled). */
	visualizationError(
		log: LogFn,
		data: { feature: string; error: string; code?: string },
	) {
		return emit(log, 'revise', 'visualization_error', data);
	},
};

/**
 * Chat page: the writer converses with the assistant about their document.
 */
export const chatLog = {
	/** The writer sent a message (typed or via a suggested-prompt chip). */
	messageSent(
		log: LogFn,
		data: { message: string; source: 'input' | 'suggested' },
	) {
		return emit(log, 'chat', 'message_sent', data);
	},
	/** The assistant's streamed response finished. */
	responseCompleted(log: LogFn, data: { responseLength: number }) {
		return emit(log, 'chat', 'response_completed', data);
	},
	/** The assistant response failed to stream (and was not cancelled). */
	responseError(log: LogFn, data: { error: string; code?: string }) {
		return emit(log, 'chat', 'response_error', data);
	},
	/** The writer discarded the transcript and started a new conversation. */
	conversationReset(log: LogFn) {
		return emit(log, 'chat', 'conversation_reset');
	},
};

/**
 * Document references (doctext links) — the citations in a model reply that
 * point at the writer's own text.
 *
 * More than one page renders them (Revise's visualizations are built out of
 * them; Chat cites the same way), and they behave identically wherever they
 * appear, so — like {@link briefLog} — the page is a parameter rather than
 * being baked into the helper.
 */
export const referenceLog = {
	/** The writer clicked a document reference. */
	clicked(log: LogFn, page: LogPage, data: { target: string }) {
		return emit(log, page, 'reference_clicked', data);
	},
	/**
	 * A clicked reference finished resolving. `found` records whether the quote
	 * was located at all; `attempts` and `durationMs` measure what the writer
	 * waited through (each attempt is a round-trip to the editor), which is the
	 * only way to see from the logs that a link felt broken.
	 */
	resolved(
		log: LogFn,
		page: LogPage,
		data: {
			target: string;
			found: boolean;
			attempts: number;
			durationMs: number;
		},
	) {
		return emit(log, page, 'reference_resolved', data);
	},
};

/**
 * The document brief (audience / purpose / constraints), which is edited from a
 * section shared by every page rather than owned by one of them — so unlike the
 * helpers above, the page is a parameter.
 *
 * Only whether a field ended up with content is recorded, never what the writer
 * typed. The text is document-level context and there is no consent-gated key
 * for it (see `@/consent` `KEY_MIN_LEVEL`); it reaches the study logs anyway as
 * part of the `docContext`-adjacent prompts each page already logs.
 */
export const docBriefLog = {
	/** The writer left a brief field after changing it. */
	fieldEdited(
		log: LogFn,
		page: LogPage,
		data: { field: string; hasContent: boolean },
	) {
		return emit(log, page, 'brief_edited', data);
	},
};

/**
 * Tools page: the writer launches an external writing tool from the sidebar. The
 * document snapshot itself is never logged here (only whether one was shared); the
 * tool's own events are attributed to it server-side via its client_id.
 */
export const toolsLog = {
	/** The writer launched a registered first-party tool via a handoff grant. */
	toolLaunched(
		log: LogFn,
		data: { tool: string; sharedDoc: boolean; scopes: string[] },
	) {
		return emit(log, 'tools', 'tool_launched', data);
	},
	/** A handoff grant could not be minted (launch aborted). */
	launchError(log: LogFn, data: { tool: string; error: string }) {
		return emit(log, 'tools', 'launch_error', data);
	},
	/** The writer opened an ad-hoc pasted URL directly (no grant; device-flow tool). */
	adhocOpened(log: LogFn) {
		return emit(log, 'tools', 'adhoc_opened', {});
	},
};

/**
 * Partners page: the proactive-thought-partners probe
 * (`docs/proactive-partners-reproduction.md`).
 *
 * Two things make these events unlike every other page's. First, most of them
 * are *system*-initiated — the writer did not ask for anything, so a reader
 * measuring engagement has to compare what was offered against what was
 * opened, not just count generations. Second, the interesting negative case is
 * silence: `partners_activated` with `activated: 0` is the decision engine
 * deciding not to interrupt, which is the outcome the paper reports as most
 * common and is exactly what a reader needs to see.
 */
export const partnersLog = {
	/** The writer added, edited, or removed a partner in the config panel. */
	partnerConfigured(
		log: LogFn,
		data: {
			action: 'created' | 'updated' | 'deleted' | 'enabled' | 'disabled';
			triggers: string[];
			hasRole: boolean;
			hasHeuristic: boolean;
		},
	) {
		return emit(log, 'partners', 'partner_configured', data);
	},
	/** The writer switched watching on or off. */
	watchToggled(log: LogFn, data: { watching: boolean; partners: number }) {
		return emit(log, 'partners', 'watch_toggled', data);
	},
	/**
	 * A trigger fired. `candidates` is how many partners listen for it — a
	 * trigger with none never reaches the decision engine.
	 */
	triggerFired(
		log: LogFn,
		data: { trigger: string; candidates: number; charsInWindow: number },
	) {
		return emit(log, 'partners', 'trigger_fired', data);
	},
	/** The decision engine answered. `activated: 0` means it chose silence. */
	partnersActivated(
		log: LogFn,
		data: {
			trigger: string;
			candidates: number;
			activated: number;
			latencyMs: number;
		},
	) {
		return emit(log, 'partners', 'partners_activated', data);
	},
	/** A tag faded out without being opened — the paper's "Ignoring". */
	activationIgnored(log: LogFn, data: { trigger: string }) {
		return emit(log, 'partners', 'activation_ignored', data);
	},
	/** The writer clicked a tag, which is what asks for the suggestion. */
	activationOpened(
		log: LogFn,
		data: { trigger: string; ageMs: number; docContext: string },
	) {
		return emit(log, 'partners', 'activation_opened', data);
	},
	/** A suggestion arrived (or failed). `response` is the partner's text. */
	suggestionGenerated(
		log: LogFn,
		data: { trigger: string; latencyMs: number; response: string },
	) {
		return emit(log, 'partners', 'suggestion_generated', data);
	},
	/** The writer asked the partner a follow-up question. */
	followUpSent(log: LogFn, data: { message: string; turn: number }) {
		return emit(log, 'partners', 'follow_up_sent', data);
	},
	/** The writer dismissed an open card. */
	activationDismissed(
		log: LogFn,
		data: { trigger: string; opened: boolean },
	) {
		return emit(log, 'partners', 'activation_dismissed', data);
	},
	/** A generation failed. `error` carries the provider text, not the UI sentence. */
	generationError(
		log: LogFn,
		data: {
			stage: 'decision' | 'suggestion' | 'follow_up';
			error: string;
			code?: string;
		},
	) {
		return emit(log, 'partners', 'generation_error', data);
	},
};
