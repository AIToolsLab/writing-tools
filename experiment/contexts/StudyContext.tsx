'use client';

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
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
  experiment: 'type',
  isProlific: true,
  scenario: 'roomDoubleBooking',
  conversationHistory: true,
});

/**
 * Derived condition name from condition code
 */
export const studyConditionAtom = atom<ConditionName>((get) => {
  const params = get(studyParamsAtom);
  return letterToCondition[params.condition];
});

// Every study page transition is a full page load, so the URL at startup
// identifies this page. Keying by page keeps one survey's answers out of the
// next survey's surveyComplete log.
const surveyStorageKey = (() => {
  if (typeof window === 'undefined') return 'surveyInputs';
  const params = new URLSearchParams(window.location.search);
  return `surveyInputs:${params.get('username')}:${params.get('page')}`;
})();

/**
 * Survey form state for the current page; saved to localStorage so answers
 * survive a reload.
 */
export const surveyInputAtom = atomWithStorage<Record<string, unknown>>(
  surveyStorageKey,
  {},
  undefined,
  { getOnInit: true }
);

/** Forget this page's saved answers (once they're submitted). */
export function clearSavedSurveyInputs() {
  try {
    localStorage.removeItem(surveyStorageKey);
  } catch {
    // ignore
  }
}

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
