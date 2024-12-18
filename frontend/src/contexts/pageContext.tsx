import { PropsWithChildren, createContext, useState } from 'react';

export const PageContext = createContext({
	page: 'draft',
	changePage: (_page: string) => {}
});

export default function PageContextWrapper({
	children
}: PropsWithChildren<any>) {
	const [page, updatePage] = useState('draft');

	return (
		<PageContext.Provider value={ { page, changePage: updatePage } }>
			{ children }
		</PageContext.Provider>
	);
}
