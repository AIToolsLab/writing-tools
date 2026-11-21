/**
 * Frontend event logging.
 *
 * Every user-facing page (Draft, Revise, Chat) records interaction events
 * through the helpers in this module so that the study logs share one
 * consistent schema. Each event is written as:
 *
 *   { schema_version, page, event, timestamp, usage, ai_output, document }
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
 * once and passes the resulting {@link LogFn} to these helpers.
 *
 * Every payload field goes in a consent bucket, named after the lowest level
 * allowed to store it (see `@/consent` `LogBuckets`):
 *   - `usage`     — counts, timings, modes, ids. Primitives only.
 *   - `ai_output` — what the assistant showed the writer.
 *   - `document`  — anything the writer wrote: document text, messages,
 *                   quoted spans, proposed edits, the brief.
 * Helpers keep their flat call-site signatures and sort fields into buckets
 * themselves, so the classification of every logged field is in this file.
 * When unsure, use the higher bucket: a field stored too rarely is a lost
 * metric, a field stored too often breaks what we told the writer.
 *
 * Event names and payload shapes are declared once here (never inline at call
 * sites) so the naming convention stays consistent and payloads are type
 * checked. To add an event, add a method to the relevant page's helper object.
 */
import type { LogBuckets } from '@/consent';
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
 *   6 — Chat proposes edits: `edit_proposed`, `edit_auto_denied`,
 *       `edit_accepted`, `edit_declined`, `edit_set_aside`, `edit_failed`,
 *       `edit_undone`, `edit_undo_refused`. Content rides in `proposal` and
 *       `offending`, both document-level.
 *   7 — Added the Workbench lab page (token-level highlights and predictions
 *       against vLLM) and its events, all usage-level metadata: response
 *       times, counts and lengths, never text.
 *   8 — The Workbench moved from vLLM to the writing engine
 *       (llm.thoughtful-ai.com), so its `ms` aren't comparable with version 7's.
 *       `highlights_scored` and `predictions_fetched` add `serverMs`, the
 *       engine's own time for the request.
 *   9 — Payload fields moved out of the top level into consent buckets:
 *       `extra_data.usage`, `extra_data.ai_output`, `extra_data.document`.
 *       Field names are unchanged. The server drops anything outside a bucket
 *       at every level and lists the dropped names in
 *       `extra_data.unclassified_keys`.
 *  10 — New envelope columns: `doc_id` (our own id, stored in the document —
 *       see `@/api/logIdentity` for its limits), `session_id` (one per page
 *       load), and `consent_level` (the level the server applied to this
 *       line, so a missing bucket can be told apart from one never sent).
 */
export const LOG_SCHEMA_VERSION = 10;

/** Pages that emit events. Matches the user-facing tabs. */
export type LogPage = 'draft' | 'revise' | 'chat' | 'tools' | 'workbench';

/**
 * Emit one event through the page's {@link LogFn}, stamping the schema version,
 * page, and event name. The single place the envelope is assembled.
 */
function emit(
	log: LogFn,
	page: LogPage,
	event: string,
	buckets: LogBuckets = {},
): Promise<void> {
	return log({ schema_version: LOG_SCHEMA_VERSION, page, event, ...buckets });
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
		const { docContext, ...usage } = data;
		return emit(log, 'draft', 'suggestion_requested', {
			usage,
			document: { docContext },
		});
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
		const { docContext, result, ...usage } = data;
		return emit(log, 'draft', 'suggestion_shown', {
			usage,
			ai_output: { result },
			document: { docContext },
		});
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
		const { docContext, result, ...usage } = data;
		return emit(log, 'draft', 'suggestion_deleted', {
			usage,
			ai_output: { result },
			document: { docContext },
		});
	},
	/** The model returned an empty suggestion, so nothing was shown. */
	suggestionEmpty(
		log: LogFn,
		data: { generationType: string; docContext: DocContext },
	) {
		const { docContext, ...usage } = data;
		return emit(log, 'draft', 'suggestion_empty', {
			usage,
			document: { docContext },
		});
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
		const { docContext, ...usage } = data;
		return emit(log, 'draft', 'generation_error', {
			usage,
			document: { docContext },
		});
	},
	/** An automatic (non-user-initiated) refresh fired. */
	autoRefresh(
		log: LogFn,
		data: { generationType: string; docContext: DocContext },
	) {
		const { docContext, ...usage } = data;
		return emit(log, 'draft', 'auto_refresh', {
			usage,
			document: { docContext },
		});
	},
};

/**
 * Revise page: the writer picks "features" (visualizations of their document)
 * and runs them, then can click document references in the results.
 */
export const reviseLog = {
	/** A feature checkbox was toggled on or off. */
	featureToggled(log: LogFn, data: { feature: string; selected: boolean }) {
		return emit(log, 'revise', 'feature_toggled', { usage: data });
	},
	/** The "Run" button was pressed for the current set of selected features. */
	featuresRun(log: LogFn, data: { features: string[] }) {
		return emit(log, 'revise', 'features_run', { usage: data });
	},
	/** A single feature's visualization request started streaming. */
	visualizationRequested(
		log: LogFn,
		data: { feature: string; isOverall: boolean; docContext: DocContext },
	) {
		const { docContext, ...usage } = data;
		return emit(log, 'revise', 'visualization_requested', {
			usage,
			document: { docContext },
		});
	},
	/** A visualization finished streaming successfully. */
	visualizationCompleted(
		log: LogFn,
		data: { feature: string; response: string },
	) {
		const { response, ...usage } = data;
		return emit(log, 'revise', 'visualization_completed', {
			usage,
			ai_output: { response },
		});
	},
	/** A visualization request failed (and was not merely cancelled). */
	visualizationError(
		log: LogFn,
		data: { feature: string; error: string; code?: string },
	) {
		return emit(log, 'revise', 'visualization_error', { usage: data });
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
		const { message, ...usage } = data;
		return emit(log, 'chat', 'message_sent', {
			usage,
			document: { message },
		});
	},
	/** The assistant's streamed response finished. */
	responseCompleted(log: LogFn, data: { responseLength: number }) {
		return emit(log, 'chat', 'response_completed', { usage: data });
	},
	/** The assistant response failed to stream (and was not cancelled). */
	responseError(log: LogFn, data: { error: string; code?: string }) {
		return emit(log, 'chat', 'response_error', { usage: data });
	},
	/** The writer discarded the transcript and started a new conversation. */
	conversationReset(log: LogFn) {
		return emit(log, 'chat', 'conversation_reset');
	},
	/**
	 * An edit proposal's lifecycle. `tool` and `kind` are usage-level; the op
	 * itself goes in `proposal` (document-level, it quotes the document).
	 *   - proposed: shown to the writer for approval
	 *   - auto_denied: failed the word-bank check, never shown; `offending` is
	 *     the first run of words that wasn't the writer's
	 *   - accepted / declined / set_aside: the writer's verdict (set aside = they
	 *     sent a new message with the card still open)
	 *   - failed: accepted, but applying it failed (e.g. the text moved)
	 *   - undone / undo_refused: the writer clicked Undo; refused when the text
	 *     had changed since
	 */
	edit(
		log: LogFn,
		outcome:
			| 'proposed'
			| 'auto_denied'
			| 'accepted'
			| 'declined'
			| 'set_aside'
			| 'failed'
			| 'undone'
			| 'undo_refused',
		data: {
			tool: string;
			kind: string;
			toolCallId: string;
			proposal?: unknown;
			/** auto_denied: why (`word_bank`, or `no_match` for a stale target). */
			reason?: 'word_bank' | 'no_match';
			offending?: string;
		},
	) {
		const { proposal, offending, ...usage } = data;
		return emit(log, 'chat', `edit_${outcome}`, {
			usage,
			document: { proposal, offending },
		});
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
		return emit(log, page, 'reference_clicked', { document: data });
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
		const { target, ...usage } = data;
		return emit(log, page, 'reference_resolved', {
			usage,
			document: { target },
		});
	},
};

/**
 * The document brief (audience / purpose / constraints), which is edited from a
 * section shared by every page rather than owned by one of them — so unlike the
 * helpers above, the page is a parameter.
 *
 * Only whether a field ended up with content is recorded, never what the writer
 * typed. If the text is ever logged, it belongs in the `document` bucket.
 */
export const docBriefLog = {
	/** The writer left a brief field after changing it. */
	fieldEdited(
		log: LogFn,
		page: LogPage,
		data: { field: string; hasContent: boolean },
	) {
		return emit(log, page, 'brief_edited', { usage: data });
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
		return emit(log, 'tools', 'tool_launched', { usage: data });
	},
	/** A handoff grant could not be minted (launch aborted). */
	launchError(log: LogFn, data: { tool: string; error: string }) {
		return emit(log, 'tools', 'launch_error', { usage: data });
	},
	/** The writer opened an ad-hoc pasted URL directly (no grant; device-flow tool). */
	adhocOpened(log: LogFn) {
		return emit(log, 'tools', 'adhoc_opened');
	},
};

/**
 * Workbench page: a passage taken off to the side, scored for highlights or
 * rewritten with predictions, against the writing engine directly. `ms` is
 * the wall time of the whole operation (all its requests), which is what to
 * watch for the server getting untenable; `serverMs` is the engine's share.
 * Before schema 8 the server was vLLM, so earlier times aren't comparable.
 */
export const workbenchLog = {
	/** The writer pulled a passage from the document. */
	passagePulled(
		log: LogFn,
		data: { source: string; chars: number; hasPreviousParagraph: boolean },
	) {
		return emit(log, 'workbench', 'passage_pulled', { usage: data });
	},
	/** A highlights request finished. */
	highlightsScored(
		log: LogFn,
		data: {
			model: string;
			ms: number;
			serverMs: number;
			tokens: number;
			ranges: number;
		},
	) {
		return emit(log, 'workbench', 'highlights_scored', { usage: data });
	},
	/** A predictions request finished (cache misses only). */
	predictionsFetched(
		log: LogFn,
		data: {
			model: string;
			ms: number;
			serverMs: number;
			branches: number;
			words: number;
		},
	) {
		return emit(log, 'workbench', 'predictions_fetched', { usage: data });
	},
	/**
	 * The writer took a suggestion. `draftChars` is the draft before it, so
	 * readers can compare how much of a rewrite came from accepted text.
	 */
	suggestionAccepted(
		log: LogFn,
		data: {
			slot: number;
			acceptedChars: number;
			draftChars: number;
			fromCache: boolean;
		},
	) {
		return emit(log, 'workbench', 'suggestion_accepted', { usage: data });
	},
	/** A request to the writing engine failed. */
	requestFailed(
		log: LogFn,
		data: { kind: 'highlights' | 'predictions'; error: string },
	) {
		return emit(log, 'workbench', 'request_failed', { usage: data });
	},
};
