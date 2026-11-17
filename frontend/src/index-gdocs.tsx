/**
 * Entry point for Google Docs Add-on
 *
 * Unlike the Word add-in (index.tsx), this doesn't require Office.onReady.
 * It initializes immediately when loaded in the Google Docs sidebar.
 *
 * Auth is the same real Better Auth device flow as the Word add-in (full mode): the
 * user is authenticated with Google, but our backend still needs its own session to
 * attribute usage and gate logging, so being logged into Google is not enough. Demo
 * mode is reserved for the anonymous home-page trial and must never run here.
 */
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from './pages/app';
import { googleDocsEditorAPI } from '@/api/googleDocsEditorAPI';
import { EditorContext } from './contexts/editorContext';

import './taskpane.css';

// Signal that the React app has loaded (used by sidebar.html)
window.__REACT_APP_LOADED__ = true;

// Extend Window interface for our flag
declare global {
	interface Window {
		__REACT_APP_LOADED__?: boolean;
	}
}

// No explicit store: overallModeAtom defaults to `full`, which is what Google Docs
// wants, so — like the Word entry (index.tsx) — we render on the default Jotai store
// and never touch the mode. Demo mode is only ever set by editor.html's Router
// (page=demo), so this surface can't reach it.
const container =
	document.getElementById('root') || document.getElementById('container');

if (!container) {
	console.error('No root container found for React app');
} else {
	const root = createRoot(container);

	root.render(
		<StrictMode>
			<EditorContext.Provider value={googleDocsEditorAPI}>
				<App />
			</EditorContext.Provider>
		</StrictMode>,
	);
}
