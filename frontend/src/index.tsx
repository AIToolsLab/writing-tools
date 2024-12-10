import * as ReactDOM from 'react-dom';

import App from './pages/app';

import './taskpane.css';

let isOfficeInitialized = false;

// TODO: Fix typing issue
const render = (Component: any) => {
	if (!isOfficeInitialized) {
		Component = () => (
			<section className="ms-welcome__progress ms-u-fadeIn500">
				<p>Please sideload your add-in to see app body.</p>
			</section>
		);
	}

	ReactDOM.render(<Component />,
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
