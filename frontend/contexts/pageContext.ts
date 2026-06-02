import { atom } from 'jotai';

export enum PageName {
	Revise = 'revise',
	Chat = 'chat',
	Draft = 'draft',
}

// Which sidebar tab is active. (The legacy `OverallMode` full/demo distinction was
// dropped in the migration — the app runs in a single anonymous mode.)
export const pageNameAtom = atom<PageName>(PageName.Draft);
