import React from 'react';
import { PageContext } from '../contexts/pageContext';

import Layout from '../components/layout';

import Home from './home';
import Chat from './chat';
import Login from './login';

export interface HomeProps {
    isOfficeInitialized: boolean;
}

export default function App({ isOfficeInitialized }: HomeProps) {
    if (!isOfficeInitialized)
        return (
            <section className="ms-welcome__progress ms-u-fadeIn500">
                <p>Please sideload your addin to see app body.</p>
            </section>
        );

    const { page } = React.useContext(PageContext);
    
    if(page === 'login')
        return <Login />;

    return (
        <Layout>
            {
                page === 'reflections' ? <Home /> : <Chat />
            }
        </Layout>
    );
}
