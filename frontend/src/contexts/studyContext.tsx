import { atom } from 'jotai';

export const studyConditionAtom = atom<string | null>(null);
export const currentTaskContextAtom = atom<ContextSection[] | null>(null);
