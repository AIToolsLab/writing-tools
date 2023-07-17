import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { AppContainer } from 'react-hot-loader';

import { initializeIcons } from '@fluentui/font-icons-mdl2';
import { ThemeProvider } from '@fluentui/react';

import App from './components/app';

initializeIcons();

let isOfficeInitialized = false;

const render = (Component) => {
    ReactDOM.render(
        <AppContainer>
            <ThemeProvider>
                <Component
                    isOfficeInitialized={isOfficeInitialized}
                />
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
    (module as any).hot.accept('./components/app', () => {
        const NextApp = require('./components/app').default;
        
        render(NextApp);
    });
}
