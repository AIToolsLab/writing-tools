import { atom } from 'jotai';

export type StudyData = {
    condition: string;
    trueContext: ContextSection[];
    autoRefreshInterval: number;
};

export const studyDataAtom = atom<StudyData | null>(null);
