/**
 * localStorage-backed scratchpad persistence, shared by the non-Word hosts
 * (standalone editor, Google Docs, the default context). Word persists in the
 * document instead — see wordEditorAPI. Single key: the scratchpad is per-origin
 * here, which is what we want for the standalone editor and for surviving the
 * dev hot-reloads that prompted this.
 */

const KEY = 'mywords-scratchpad';

export async function loadScratchpadLocal(): Promise<string> {
	try {
		return localStorage.getItem(KEY) ?? '';
	} catch {
		return '';
	}
}

export async function saveScratchpadLocal(text: string): Promise<void> {
	try {
		localStorage.setItem(KEY, text);
	} catch {
		/* storage unavailable (private mode, quota) — non-fatal */
	}
}
