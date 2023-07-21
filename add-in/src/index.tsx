import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { AppContainer } from 'react-hot-loader';

import { initializeIcons } from '@fluentui/font-icons-mdl2';
import { ThemeProvider } from '@fluentui/react';
import PageContextWrapper from './contexts/pageContext';

import App from './pages/app';
import Layout from './components/layout';

import './taskpane.css';

initializeIcons();

let isOfficeInitialized = false;

const render = (Component) => {
    ReactDOM.render(
        <AppContainer>
            <ThemeProvider>
                <PageContextWrapper>
                    <Layout>
                        <Component
                            isOfficeInitialized={isOfficeInitialized}
                        />
                    </Layout>
                </PageContextWrapper>
            </ThemeProvider>
        </AppContainer>,
        document.getElementById('container')
    );
};

/* Render application after Office initializes */
Office.onReady(() => {
    isOfficeInitialized = true;
    render(App);
});

if ((module as any).hot) {
    (module as any).hot.accept('./pages/app', () => {
        const NextApp = require('./pages/app').default;
        
        render(NextApp);
    });
}
