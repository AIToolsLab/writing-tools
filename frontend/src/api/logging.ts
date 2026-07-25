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
 */
export const LOG_SCHEMA_VERSION = 2;

/** Pages that emit events. Matches the user-facing tabs. */
export type LogPage = 'draft' | 'revise' | 'chat' | 'tools';

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
		data: { generationType: string; docContext: DocContext; error: string },
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
	visualizationError(log: LogFn, data: { feature: string; error: string }) {
		return emit(log, 'revise', 'visualization_error', data);
	},
	/** The writer clicked a document reference (doctext link) in a result. */
	referenceClicked(log: LogFn, data: { target: string }) {
		return emit(log, 'revise', 'reference_clicked', data);
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
	responseError(log: LogFn, data: { error: string }) {
		return emit(log, 'chat', 'response_error', data);
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
