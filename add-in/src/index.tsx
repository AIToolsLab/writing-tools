import * as ReactDOM from 'react-dom';

import { initializeIcons } from '@fluentui/font-icons-mdl2';
import { ThemeProvider } from '@fluentui/react';
import PageContextWrapper from './contexts/pageContext';
import UserContextWrapper from './contexts/userContext';
import ChatContextWrapper from './contexts/chatContext';

import App from './pages/app';

import './taskpane.css';
import { Auth0Provider } from '@auth0/auth0-react';

initializeIcons();

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

	ReactDOM.render(
		<ThemeProvider>
			<ChatContextWrapper>
				<UserContextWrapper>
					<PageContextWrapper>
					<Auth0Provider
							domain="dev-rbroo1fvav24wamu.us.auth0.com"
							clientId="YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr"
							authorizationParams= { {
								redirectUri: `${window.location.origin}/popup.html`,
								scope: 'openid profile email read:posts',
								audience: 'textfocals.com', // Value in Identifier field for the API being called.
								leeway: 10
							} }
						>
							<Component
								isOfficeInitialized= { isOfficeInitialized }
							/>
						</Auth0Provider>

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
	(module as any).hot.accept('./pages/app', () => {
		const NextApp = require('./pages/app').default;

		render(NextApp);
	});
