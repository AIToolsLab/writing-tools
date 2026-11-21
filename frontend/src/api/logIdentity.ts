/**
 * The two ids that let study logs be grouped below the level of a user: which
 * document an event was about, and which sitting it happened in.
 *
 * - `session_id` is minted once per page load (this module's load), so a
 *   reload or a reopened task pane starts a new one.
 * - `doc_id` is our own random id stored in the document's settings
 *   (`EditorAPI.setDocumentSetting`), so it follows the file. We deliberately
 *   don't use the platform's id: a Google Docs id is the whole secret of an
 *   "anyone with the link" document, and Word has only file paths, which leak
 *   names.
 *
 * Known limits, accepted for now:
 * - A copy of a document (Word "Save As"; maybe Google "Make a copy") keeps
 *   the original's id, so a fork reads as the same document continuing.
 * - Where document settings fall back to localStorage — the standalone
 *   editor, and Google Docs deployments that predate the document-property
 *   bridge — the id is per browser, not per file. On a stale Google Docs
 *   deployment that means every document shares one id.
 *
 * The id is created lazily, the first time an event is actually logged, so a
 * writer at consent level `none` never has anything written into their file.
 */
import type { DocumentSettingsAPI } from '@/api/documentSettings';

/** The document setting the id is stored under. Lives in users' files: keep it. */
export const DOC_ID_SETTING_KEY = 'docId';

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function newId(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid) return uuid;
	// Non-secure contexts have no randomUUID; getRandomValues still works.
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** One per page load. */
export const LOG_SESSION_ID = newId();

// One lookup per settings object (each surface's EditorAPI is stable), so
// concurrent events on a fresh document agree on one id and write it once.
const docIds = new WeakMap<DocumentSettingsAPI, Promise<string>>();

/**
 * The current document's id, creating and storing one if it has none. Never
 * rejects: if the id can't be saved, it is still used for this page load.
 */
export function getOrCreateDocId(
	settings: DocumentSettingsAPI,
): Promise<string> {
	const cached = docIds.get(settings);
	if (cached) return cached;

	const lookup = (async () => {
		try {
			const stored =
				await settings.getDocumentSetting(DOC_ID_SETTING_KEY);
			if (stored && ID_PATTERN.test(stored)) return stored;
		} catch {
			// Fall through and mint one.
		}
		const id = newId();
		try {
			await settings.setDocumentSetting(DOC_ID_SETTING_KEY, id);
		} catch (error) {
			// e.g. a read-only document. The next load will mint a new id.
			console.warn('Could not save the document id:', error);
		}
		return id;
	})();
	docIds.set(settings, lookup);
	return lookup;
}
