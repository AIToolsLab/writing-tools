import React from 'react';
import { PageContext } from '../contexts/pageContext';

import Home, { HomeProps } from './home';
import Chat from './chat';

export default function App({ isOfficeInitialized }: HomeProps) {
    const { page } = React.useContext(PageContext);

    if(page === 'home')
        return <Home isOfficeInitialized={ isOfficeInitialized } />;
    
    return <Chat />;
}
