import type { JSX } from "react";

export type QuestionType = 'text' | 'likert' | 'radio' | 'checkbox';

export interface Question {
  id: string;
  text: string | JSX.Element;
  type: QuestionType;
  required?: boolean;
  options?: string[]; // For likert, radio, checkbox
  placeholder?: string; // For text inputs
  multiline?: boolean; // For text inputs: false = single-line input, true/undefined = textarea
  otherOption?: string; // For radio/checkbox: selecting this option shows a required text box, saved as `${id}_other`
  exclusiveOption?: string; // For checkbox: selecting this option clears the others (e.g., "None")
}

export interface SurveySection {
  title: string;
  description?: string; // Shown above the section's questions
  questions: Question[];
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
 * Confidence scale (for self-efficacy questions)
 */
export const confidenceLikert = (): string[] => [
  'Not at all confident',
  'Slightly confident',
  'Moderately confident',
  'Very confident',
  'Extremely confident',
];

/**
 * Characteristic scale (for Need for Cognition questions)
 */
export const characteristicLikert = (): string[] => [
  'Extremely uncharacteristic of me',
  'Somewhat uncharacteristic of me',
  'Uncertain',
  'Somewhat characteristic of me',
  'Extremely characteristic of me',
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
