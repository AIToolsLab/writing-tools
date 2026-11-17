import { useContext, useEffect, useRef, useState } from 'react';

import { EditorContext } from '@/contexts/editorContext';
import { canEdit } from '@/docTools/editor';

import { VoiceSession } from './voice/VoiceSession';

/**
 * Where the scratchpad is stored on the document, via `EditorAPI`'s
 * document-setting pair (Office settings in Word, Apps Script document
 * properties in Google Docs, namespaced localStorage elsewhere).
 *
 * The string is deliberately the one this page used when it carried its own
 * persistence path, so Word documents keep the scratchpads they already hold —
 * that path wrote the same Office setting under the same key. Browser-backed
 * hosts do start over, since those keys are now namespaced per document, which
 * is the fix: the standalone editor used to share one scratchpad across every
 * document on the origin.
 */
const SCRATCHPAD_SETTING_KEY = 'mywords-scratchpad';

/**
 * My Words: the voice prototype. (The text prototypes it started with,
 * Walkthrough and Propose, became Chat's own-words edits; see
 * docs/chat-document-tools.md.)
 */
export default function MyWords() {
	const editor = useContext(EditorContext);
	const [scratchpad, setScratchpad] = useState('');

	// Load the persisted scratchpad once, then debounce-save on change so it
	// survives the frequent dev reloads (and, in Word, travels with the file).
	const { getDocumentSetting, setDocumentSetting } = editor;
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
		let active = true;
		getDocumentSetting(SCRATCHPAD_SETTING_KEY)
			.then((text) => {
				if (active) setScratchpad(text ?? '');
			})
			.catch(() => {})
			.finally(() => {
				if (active) setLoaded(true);
			});
		return () => {
			active = false;
		};
	}, [getDocumentSetting]);

	/** The edit a debounced save still owes the document; null once written. */
	const pendingSaveRef = useRef<string | null>(null);
	useEffect(() => {
		if (!loaded) return;
		pendingSaveRef.current = scratchpad;
		const id = setTimeout(() => {
			pendingSaveRef.current = null;
			void setDocumentSetting(SCRATCHPAD_SETTING_KEY, scratchpad);
		}, 800);
		return () => clearTimeout(id);
	}, [scratchpad, loaded, setDocumentSetting]);

	// Don't let the debounce swallow the writer's last words. Leaving the page
	// (a tab switch unmounts this) and `pagehide` both write immediately rather
	// than waiting out the timer.
	useEffect(() => {
		function flushNow() {
			const pending = pendingSaveRef.current;
			if (pending === null) return;
			pendingSaveRef.current = null;
			void setDocumentSetting(SCRATCHPAD_SETTING_KEY, pending);
		}
		window.addEventListener('pagehide', flushNow);
		return () => {
			window.removeEventListener('pagehide', flushNow);
			flushNow();
		};
	}, [setDocumentSetting]);

	return (
		<div style={{ height: '100%' }}>
			{canEdit(editor) ? (
				<VoiceSession
					editor={editor}
					scratchpad={scratchpad}
					onScratchpadChange={setScratchpad}
				/>
			) : (
				<p style={{ padding: '0.75rem', color: '#6b7280' }}>
					My Words can’t edit documents in this editor yet.
				</p>
			)}
		</div>
	);
}
