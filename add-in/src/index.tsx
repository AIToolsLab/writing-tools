import * as ReactDOM from 'react-dom';

import { initializeIcons } from '@fluentui/font-icons-mdl2';
import { ThemeProvider } from '@fluentui/react';
import PageContextWrapper from './contexts/PageContext';
import UserContextWrapper from './contexts/UserContext';
import ChatContextWrapper from './contexts/ChatContext';

import App from './pages/App';

import './taskpane.css';

initializeIcons();

let isOfficeInitialized = false;

// TODO: Fix typing issue
const render = (Component: any) => {
	ReactDOM.render(
		<ThemeProvider>
			<ChatContextWrapper>
				<UserContextWrapper>
					<PageContextWrapper>
						<Component isOfficeInitialized={isOfficeInitialized} />
					</PageContextWrapper>
				</UserContextWrapper>
			</ChatContextWrapper>
		</ThemeProvider>,
		document.getElementById('container')
	);
};

/* Render application after Office initializes */
Office.onReady(info => {
	if (info.host === Office.HostType.Word) isOfficeInitialized = true;
	render(App);
});

if ((module as any).hot)
	(module as any).hot.accept('./pages/App', () => {
		const NextApp = require('./pages/App').default;

		render(NextApp);
	});
