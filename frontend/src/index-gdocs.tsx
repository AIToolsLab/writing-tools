/**
 * Entry point for Google Docs Add-on
 * 
 * Unlike the Word add-in (index.tsx), this doesn't require Office.onReady.
 * It initializes immediately when loaded in the Google Docs sidebar.
 * 
 * Uses demo mode to bypass Auth0 since users are already authenticated with Google.
 */
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import App from './pages/app';
import { googleDocsEditorAPI } from '@/api/googleDocsEditorAPI';
import { EditorContext } from './contexts/editorContext';
import { OverallMode, overallModeAtom } from './contexts/pageContext';

import './taskpane.css';

// Signal that the React app has loaded (used by sidebar.html)
window.__REACT_APP_LOADED__ = true;

// Extend Window interface for our flag
declare global {
	interface Window {
		__REACT_APP_LOADED__?: boolean;
	}
}

// Create a Jotai store with demo mode pre-set to bypass Auth0
const store = createStore();
store.set(overallModeAtom, OverallMode.demo);

const container = document.getElementById('root') || document.getElementById('container');

if (!container) {
	console.error('No root container found for React app');
} else {
	const root = createRoot(container);

	root.render(
		<StrictMode>
			<JotaiProvider store={store}>
				<EditorContext.Provider value={googleDocsEditorAPI}>
					<App />
				</EditorContext.Provider>
			</JotaiProvider>
		</StrictMode>,
	);
}
