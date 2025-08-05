import { createRoot } from 'react-dom/client';
import App from './pages/app';
import { wordEditorAPI } from '@/api/wordEditorAPI';

import './taskpane.css';
import { StrictMode } from 'react';
import { EditorContext } from './contexts/editorContext';

const container = document.getElementById('container')!;
const root = createRoot(container);

let isOfficeInitialized = false;

const render = (Component: React.ComponentType) => {
	if (!isOfficeInitialized) {
		root.render(
			<section className="ms-welcome__progress ms-u-fadeIn500">
				<p>Please sideload your add-in to see app body.</p>
			</section>,
		);
		return;
	}
	root.render(
		<StrictMode>
			<EditorContext.Provider value={wordEditorAPI}>
				<Component />
			</EditorContext.Provider>
		</StrictMode>,
	);
};

/* Render application after Office initializes */
Office.onReady((info) => {
	if (info.host === Office.HostType.Word) isOfficeInitialized = true;
	render(App);
});

if ((module as any).hot)
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	(module as any).hot.accept('./pages/app', () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const NextApp = require('./pages/app').default as typeof App;

		render(NextApp);
	});
