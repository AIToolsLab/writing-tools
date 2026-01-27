import type { ConditionCode, ConditionName } from '@/types/study';
import scenariosData from './scenarios.json';

// Study wave identifier
export const WAVE = 'pilot-3';

// Git commit - populated at build time
export const GIT_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT || 'unknown';

// Prolific completion code
export const COMPLETION_CODE = 'C1MRQXLI';

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
export const CONSENT_FORM_URL = 'https://calvin.co1.qualtrics.com/jfe/form/SV_3adI70Zxk7e2ueW';

// Minimum screen dimensions
export const MIN_SCREEN_WIDTH = 600;
export const MIN_SCREEN_HEIGHT = 500;

// Valid condition codes
export const VALID_CONDITIONS = Object.keys(letterToCondition) as ConditionCode[];

// Scenario configuration types
export interface ScenarioConfig {
  sender: {
    name: string;          // Full name displayed in chat header
  };
  id: string;
  colleague: {
    name: string;          // Full name displayed in chat header
    firstName: string;      // First name used in task instructions
    role: string;          // Job title displayed in chat header
  };
  recipient: {
    name: string;          // Full name
    email: string;         // Email address
  };
  taskInstructions: {
    title: string;         // Page title
    description: string;   // Scenario description for participants
    companyFraming: string; // Company reputation reminder
  };
  chat: {
    initialMessages: string[];  // Opening messages from colleague
    followUpMessage: string;    // Proactive nudge if user doesn't engage
    systemPrompt: string;       // Full scenario context for AI
  };
}

// Available scenarios (imported from JSON, cast to correct type)
// The JSON includes an 'analysis' field for Python scripts that we exclude from the runtime type
export const SCENARIOS: Record<string, ScenarioConfig> = Object.fromEntries(
  Object.entries(scenariosData).map(([key, value]) => [
    key,
    {
      id: value.id,
      sender: value.sender,
      colleague: value.colleague,
      recipient: value.recipient,
      taskInstructions: value.taskInstructions,
      chat: value.chat,
    } as ScenarioConfig,
  ])
);

// Default scenario
export const DEFAULT_SCENARIO_ID = 'roomDoubleBooking';

/**
 * Get the scenario configuration for the current study session
 * @param scenarioId - Optional scenario ID, defaults to DEFAULT_SCENARIO_ID
 * @returns The scenario configuration
 */
export function getScenario(scenarioId?: string): ScenarioConfig {
  const id = scenarioId || DEFAULT_SCENARIO_ID;
  const scenario = SCENARIOS[id];

  if (!scenario) {
    console.warn(`Scenario ${id} not found, falling back to default`);
    return SCENARIOS[DEFAULT_SCENARIO_ID];
  }

  return scenario;
}

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
