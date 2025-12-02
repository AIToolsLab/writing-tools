// Study-related types and interfaces

export type LogEventType =
  | 'view:consent'
  | 'view:intro'
  | 'view:intro-survey'
  | 'view:start-task'
  | 'view:task'
  | 'view:post-task-survey'
  | 'view:final'
  | 'launchConsentForm'
  | 'Started Study'
  | 'taskStart'
  | 'taskComplete'
  | 'documentUpdate'
  | `aiAutoRefresh:${string}`
  | `aiRequest:${string}`
  | `aiResponse:${string}`
  | 'surveyComplete:intro-survey'
  | 'surveyComplete:post-task-survey';

export interface LogPayload {
  username: string;
  event: LogEventType;
  extra_data?: Record<string, unknown>;
}

export interface LogEntry extends LogPayload {
  timestamp: string;
  wave: string;
  gitCommit: string;
}

export type ConditionCode = 'n' | 'c' | 'e' | 'a' | 'p';

export type ConditionName =
  | 'no_ai'
  | 'complete_document'
  | 'example_sentences'
  | 'analysis_readerPerspective'
  | 'proposal_advice';

export interface StudyParams {
  username: string;
  condition: ConditionCode;
  page: string;
  experiment?: 'amount' | 'type';
  isProlific?: boolean;
  autoRefreshInterval?: number;
}

export interface BrowserMetadata extends Record<string, unknown> {
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
  windowWidth: number;
  windowHeight: number;
  colorDepth: number;
  pixelDepth: number;
  timezone: string;
  languages: string[];
  platform: string;
  cookieEnabled: boolean;
  onLine: boolean;
}
