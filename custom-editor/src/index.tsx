import React from 'react';
import ReactDOM from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';

import App from './pages/app';
import './globals.css';  


const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
    <Auth0Provider
        domain="dev-62nhczyl7e1oaj8a.us.auth0.com"
        clientId="UiUylEwBu5NzYfbjaHuBd0294tqUzlok"
        authorizationParams={ {
            redirectUri: window.location.origin,
            scope: 'openid profile email read:posts',
            audience: 'https://tools.kenarnold.org/api', // Value in Identifier field for the API being called.
            leeway: 10, 
        } }
    >
        <App />
    </Auth0Provider>
);
