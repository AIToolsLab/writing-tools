/**
 * Frontend event logging.
 *
 * Every user-facing page (Draft, Revise, Chat) records interaction events
 * through the helpers in this module so that the study logs share one
 * consistent schema. Each event is written as:
 *
 *   { schema_version, page, event, username, timestamp, ...data }
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
 * Event names and payload shapes are declared once here (never inline at call
 * sites) so the naming convention stays consistent and payloads are type
 * checked. To add an event, add a method to the relevant page's helper object.
 */
import { log } from './index';

/**
 * Version of the frontend event-log schema. Bump when the envelope or any event
 * payload changes shape in a way log readers must branch on.
 *
 * History:
 *   1 — Initial page-scoped schema (Draft / Revise / Chat).
 */
export const LOG_SCHEMA_VERSION = 1;

/** Pages that emit events. Matches the user-facing tabs. */
export type LogPage = 'draft' | 'revise' | 'chat';

/** Fields stamped onto every event by {@link logEvent}. */
interface LogEnvelope {
	schema_version: number;
	page: LogPage;
	event: string;
	username: string;
}

/**
 * Low-level event emitter. Prefer the typed per-page helpers below — this is
 * the single place that stamps the schema version and page onto the payload.
 */
function logEvent(
	page: LogPage,
	username: string,
	event: string,
	data: Record<string, unknown> = {},
): Promise<Response> {
	const envelope: LogEnvelope = {
		schema_version: LOG_SCHEMA_VERSION,
		page,
		event,
		username,
	};
	return log({ ...envelope, ...data });
}

/**
 * Draft page: the writer requests short next-step suggestions for a chosen mode
 * (examples, questions, advice, rewording) and can save or delete them.
 */
export const draftLog = {
	/** A suggestion mode button was clicked. */
	suggestionRequested(
		username: string,
		data: { generationType: string; docContext: DocContext },
	) {
		return logEvent('draft', username, 'suggestion_requested', data);
	},
	/** A generated suggestion was shown to (and saved for) the writer. */
	suggestionShown(
		username: string,
		data: { generationType: string; docContext: DocContext; result: GenerationResult },
	) {
		return logEvent('draft', username, 'suggestion_shown', data);
	},
	/** The writer deleted a saved suggestion. */
	suggestionDeleted(
		username: string,
		data: { generationType: string; docContext: DocContext; result: GenerationResult },
	) {
		return logEvent('draft', username, 'suggestion_deleted', data);
	},
	/** The model returned an empty suggestion, so nothing was shown. */
	suggestionEmpty(
		username: string,
		data: { generationType: string; docContext: DocContext },
	) {
		return logEvent('draft', username, 'suggestion_empty', data);
	},
	/** A suggestion request failed (timeout or model error). */
	generationError(
		username: string,
		data: { generationType: string; docContext: DocContext; error: string },
	) {
		return logEvent('draft', username, 'generation_error', data);
	},
	/** An automatic (non-user-initiated) refresh fired. */
	autoRefresh(
		username: string,
		data: { generationType: string; docContext: DocContext },
	) {
		return logEvent('draft', username, 'auto_refresh', data);
	},
};

/**
 * Revise page: the writer picks "features" (visualizations of their document)
 * and runs them, then can click document references in the results.
 */
export const reviseLog = {
	/** A feature checkbox was toggled on or off. */
	featureToggled(
		username: string,
		data: { feature: string; selected: boolean },
	) {
		return logEvent('revise', username, 'feature_toggled', data);
	},
	/** The "Run" button was pressed for the current set of selected features. */
	featuresRun(username: string, data: { features: string[] }) {
		return logEvent('revise', username, 'features_run', data);
	},
	/** A single feature's visualization request started streaming. */
	visualizationRequested(
		username: string,
		data: { feature: string; isOverall: boolean; docContext: DocContext },
	) {
		return logEvent('revise', username, 'visualization_requested', data);
	},
	/** A visualization finished streaming successfully. */
	visualizationCompleted(
		username: string,
		data: { feature: string; response: string },
	) {
		return logEvent('revise', username, 'visualization_completed', data);
	},
	/** A visualization request failed (and was not merely cancelled). */
	visualizationError(
		username: string,
		data: { feature: string; error: string },
	) {
		return logEvent('revise', username, 'visualization_error', data);
	},
	/** The writer clicked a document reference (doctext link) in a result. */
	referenceClicked(username: string, data: { target: string }) {
		return logEvent('revise', username, 'reference_clicked', data);
	},
};

/**
 * Chat page: the writer converses with the assistant about their document.
 */
export const chatLog = {
	/** The writer sent a message (typed or via a suggested-prompt chip). */
	messageSent(
		username: string,
		data: { message: string; source: 'input' | 'suggested' },
	) {
		return logEvent('chat', username, 'message_sent', data);
	},
	/** The assistant's streamed response finished. */
	responseCompleted(
		username: string,
		data: { responseLength: number },
	) {
		return logEvent('chat', username, 'response_completed', data);
	},
	/** The assistant response failed to stream (and was not cancelled). */
	responseError(username: string, data: { error: string }) {
		return logEvent('chat', username, 'response_error', data);
	},
};
