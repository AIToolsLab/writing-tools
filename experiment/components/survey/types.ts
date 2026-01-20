export type QuestionType = 'text' | 'likert' | 'radio' | 'checkbox';

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  required?: boolean;
  options?: string[]; // For likert, radio, checkbox
  placeholder?: string; // For text inputs
  multiline?: boolean; // For text inputs: false = single-line input, true/undefined = textarea
}

/**
 * Standard 5-point Likert scale
 */
export const likert = (): string[] => [
  'Strongly Disagree',
  'Disagree',
  'Neutral',
  'Agree',
  'Strongly Agree',
];

/**
 * Agreement scale (for questions phrased as "I agree that...")
 */
export const agreeLikert = (): string[] => [
  'Strongly Disagree',
  'Disagree',
  'Neutral',
  'Agree',
  'Strongly Agree',
];

/**
 * Effort scale (for Task Load Index questions)
 */
export const effortLikert = (): string[] => [
  'Very Low',
  'Low',
  'Medium',
  'High',
  'Very High',
];
