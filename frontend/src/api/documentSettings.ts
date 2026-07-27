/**
 * A localStorage-backed stand-in for the document-scoped half of `EditorAPI`.
 *
 * Word and Google Docs each have somewhere inside the document to put small
 * values (Office settings, Apps Script document properties), so on those
 * surfaces `getDocumentSetting`/`setDocumentSetting` genuinely travel with the
 * file. The standalone editor and the bare context default have no host
 * document at all, and the Google Docs sidebar can be running against an Apps
 * Script deployment that predates the document-property bridge. Those cases use
 * this instead: still keyed per document, but only on this browser.
 *
 * Storage failures are swallowed (a private-browsing quota error, a sandbox
 * with no localStorage). A setting that fails to persist is a lost preference,
 * never a broken page.
 */

const PREFIX = 'docSetting';

export type DocumentSettingsAPI = Pick<
	EditorAPI,
	'getDocumentSetting' | 'setDocumentSetting'
>;

/**
 * @param namespace Identifies the document these settings belong to, so two
 *   documents open in the same browser don't share one brief.
 */
export function localStorageDocumentSettings(
	namespace: string,
): DocumentSettingsAPI {
	const storageKey = (key: string) => `${PREFIX}:${namespace}:${key}`;

	return {
		getDocumentSetting(key: string): Promise<string | null> {
			try {
				return Promise.resolve(localStorage.getItem(storageKey(key)));
			} catch (error) {
				console.warn(`Could not read document setting "${key}":`, error);
				return Promise.resolve(null);
			}
		},

		setDocumentSetting(key: string, value: string): Promise<void> {
			try {
				localStorage.setItem(storageKey(key), value);
			} catch (error) {
				console.warn(`Could not save document setting "${key}":`, error);
			}
			return Promise.resolve();
		},
	};
}
