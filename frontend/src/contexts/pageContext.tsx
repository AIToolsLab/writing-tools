import { atom } from "jotai";

export enum PageName {
	Revise = 'revise',
	SearchBar = 'searchbar',
	Chat = 'chat',
	Draft = 'draft'
  }


export const pageNameAtom = atom<PageName>(PageName.Draft);
