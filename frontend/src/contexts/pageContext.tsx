import { PropsWithChildren, createContext, useState } from 'react';
export enum PageName {
	Revise = 'revise',
	SearchBar = 'searchbar',
	Chat = 'chat',
	Draft = 'draft'
  }


export const PageContext = createContext<{
  page: PageName;
  changePage: (page: PageName) => void;
}>({
  page: PageName.Draft,
  changePage: () => {},
});

export default function PageContextWrapper({
	children
}: PropsWithChildren<any>) {
	const [page, updatePage] = useState(PageName.Draft);

	return (
		<PageContext.Provider value={ { page, changePage: updatePage } }>
			{ children }
		</PageContext.Provider>
	);
}
