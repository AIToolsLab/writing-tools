import React from 'react';
import Navbar from '../Navbar';

export default function Layout({ children }: React.PropsWithChildren<any>) {
    return (
        <>
            <Navbar />
            
            { children }
        </>
    );
}
