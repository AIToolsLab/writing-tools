import { atom } from 'jotai';

export type StudyData = {
    condition: string;
    trueContext: ContextSection[];
    falseContext: ContextSection[];
};

export const studyDataAtom = atom<StudyData | null>(null);
