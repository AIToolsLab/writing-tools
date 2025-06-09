import * as React from 'react';
import * as ReactDOM from 'react-dom';
import App, { HomeProps } from './pages/app';
import { wordEditorAPI } from '@/api/wordEditorAPI';

import './taskpane.css';

let isOfficeInitialized = false;

const render = (Component: React.ComponentType<HomeProps>) => {
	ReactDOM.render(
		isOfficeInitialized ? (
			<Component editorAPI={ wordEditorAPI } />
		) : (
			<section className="ms-welcome__progress ms-u-fadeIn500">
				<p>Please sideload your add-in to see app body.</p>
			</section>
		),
		document.getElementById('container')
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
