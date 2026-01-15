'use client';

import { atom } from 'jotai';
import type { StudyParams, ConditionName } from '@/types/study';
import { letterToCondition, DEFAULT_AUTO_REFRESH_INTERVAL } from '@/lib/studyConfig';

/**
 * Study parameters from URL (username, condition, page, etc.)
 */
export const studyParamsAtom = atom<StudyParams>({
  username: '',
  condition: 'n',
  page: 'consent',
  autoRefreshInterval: DEFAULT_AUTO_REFRESH_INTERVAL,
});

/**
 * Derived condition name from condition code
 */
export const studyConditionAtom = atom<ConditionName>((get) => {
  const params = get(studyParamsAtom);
  return letterToCondition[params.condition];
});

/**
 * Survey form state - shared across all surveys
 */
export const surveyInputAtom = atom<Record<string, unknown>>({});

/**
 * Helper to update study params
 */
export const updateStudyParamsAtom = atom(
  null,
  (get, set, params: Partial<StudyParams>) => {
    const current = get(studyParamsAtom);
    set(studyParamsAtom, { ...current, ...params });
  }
);
