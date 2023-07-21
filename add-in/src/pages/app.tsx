import React from 'react';
import { PageContext } from '../contexts/pageContext';

import Home from './home';
import Chat from './chat';

export interface HomeProps {
    isOfficeInitialized: boolean;
}

export default function App({ isOfficeInitialized }: HomeProps) {
    if (!isOfficeInitialized) {
        return (
            <section className="ms-welcome__progress ms-u-fadeIn500">
                <p>Please sideload your addin to see app body.</p>
            </section>
        );
    }

    const { page } = React.useContext(PageContext);

    if(page === 'reflections')
        return <Home />;
    
    return <Chat />;
}
