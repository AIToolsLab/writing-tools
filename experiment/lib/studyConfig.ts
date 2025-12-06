import { ConditionCode, ConditionName } from '@/types/study';

// Study wave identifier
export const WAVE = 'pilot-1';

// Git commit - populated at build time
export const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown';

// Prolific completion code
export const COMPLETION_CODE = 'C1234567';

// Default auto-refresh interval (15 seconds)
export const DEFAULT_AUTO_REFRESH_INTERVAL = 15000;

// API timeout for AI requests (20 seconds)
export const API_TIMEOUT_MS = 20000;

// Study page sequence
export const STUDY_PAGES = [
  'consent',
  'intro',
  'intro-survey',
  'start-task',
  'task',
  'post-task-survey',
  'final',
] as const;

// Map condition code to condition name
export const letterToCondition: Record<ConditionCode, ConditionName> = {
  // Study 1: Amount of AI
  n: 'no_ai',
  c: 'complete_document',
  e: 'example_sentences',

  // Study 2: Type of AI
  a: 'analysis_readerPerspective',
  p: 'proposal_advice',
};

// Consent form URL (Qualtrics)
export const CONSENT_FORM_URL = 'https://example.com/consent';

// Minimum screen dimensions
export const MIN_SCREEN_WIDTH = 600;
export const MIN_SCREEN_HEIGHT = 500;

// Valid condition codes
export const VALID_CONDITIONS = Object.keys(letterToCondition) as ConditionCode[];

/**
 * Get the next page in the study sequence
 * @param currentPage - The current page name
 * @returns The next page name, or null if at the end
 */
export function getNextPage(currentPage: string): string | null {
  const currentIndex = STUDY_PAGES.indexOf(
    currentPage as typeof STUDY_PAGES[number]
  );
  if (currentIndex === -1 || currentIndex === STUDY_PAGES.length - 1) {
    return null;
  }
  return STUDY_PAGES[currentIndex + 1];
}
