import React, { PropsWithChildren, createContext, useState } from 'react';

export const PageContext = createContext({
    page: '',
    changePage: (_page: string) => {},
});

export default function PageContextWrapper({
    children,
}: PropsWithChildren<any>) {
    const [page, updatePage] = useState(
        ['reflections', 'chat'][Math.floor(Math.random() * 2)]
    );

    return (
        <PageContext.Provider value={{ page, changePage: updatePage }}>
            {children}
        </PageContext.Provider>
    );
}
