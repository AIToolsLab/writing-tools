import { atom } from 'jotai';

export enum PageName {
	Revise = 'revise',
	Chat = 'chat',
	Draft = 'draft',
	TagLinker = 'tag-linker',
	MyWords = 'my-words',
}

export enum OverallMode {
	full = 'full',
	demo = 'demo',
}

export const pageNameAtom = atom<PageName>(PageName.Draft);
export const overallModeAtom = atom<OverallMode>(OverallMode.full);
