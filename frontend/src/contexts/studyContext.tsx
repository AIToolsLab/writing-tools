import { atom } from 'jotai';

export type StudyData = {
    condition: string;
    trueContext: ContextSection[];
    falseContext: ContextSection[];
    autoRefreshInterval: number;
    contextToUse: 'true' | 'false' | 'mixed';
};

export const studyDataAtom = atom<StudyData | null>(null);
