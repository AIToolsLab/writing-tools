import * as ReactDOM from 'react-dom';

import { initializeIcons } from '@fluentui/font-icons-mdl2';
import { ThemeProvider } from '@fluentui/react';

import UserContextWrapper from './contexts/userContext';
import ChatContextWrapper from './contexts/chatContext';

import App from './pages/app';

import './taskpane.css';

initializeIcons();

let isOfficeInitialized = false;

const render = (Component: any) => {
	ReactDOM.render(
		<ThemeProvider>
			<ChatContextWrapper>
				<UserContextWrapper>
					<Component isOfficeInitialized={ isOfficeInitialized } />
				</UserContextWrapper>
			</ChatContextWrapper>
		</ThemeProvider>,
		document.getElementById('container')
	);
};

// Render application after Office initializes
Office.onReady(info => {
	if (info.host === Office.HostType.Word) isOfficeInitialized = true;
	render(App);
});

if ((module as any).hot)
	(module as any).hot.accept('./pages/app', () => {
		const NextApp = require('./pages/app').default;

		render(NextApp);
	});
