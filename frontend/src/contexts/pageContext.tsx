import { atom } from "jotai";

export enum PageName {
	Revise = 'revise',
	SearchBar = 'searchbar',
	Chat = 'chat',
	Draft = 'draft',
	Study = 'study'
  }


export enum OverallMode {
	full = 'full',
	demo = 'demo',
	study = 'study'
}

export const pageNameAtom = atom<PageName>(PageName.Draft);
export const overallModeAtom = atom<OverallMode>(OverallMode.full);
