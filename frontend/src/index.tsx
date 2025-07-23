import { createRoot } from 'react-dom/client';
import App, { HomeProps } from './pages/app';
import { wordEditorAPI } from '@/api/wordEditorAPI';

import './taskpane.css';
import { StrictMode } from 'react';

const container = document.getElementById('container')!;
const root = createRoot(container);

let isOfficeInitialized = false;

const render = (Component: React.ComponentType<HomeProps>) => {
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
			<Component editorAPI={wordEditorAPI} />
		</StrictMode>,
	);
};

/* Render application after Office initializes */
Office.onReady(info => {
	if (info.host === Office.HostType.Word) isOfficeInitialized = true;
	render(App);
});

if ((module as any).hot)
	(module as any).hot.accept('./pages/app', () => {
		const NextApp = require('./pages/app').default;

		render(NextApp);
	});
