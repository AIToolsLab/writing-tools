import { Question, likert, effortLikert } from './types';
import { ConditionName } from '@/types/study';

/**
 * Intro survey questions (demographics and experience)
 */
export const introSurveyQuestions: Question[] = [
  {
    id: 'age',
    text: 'What is your age?',
    type: 'text',
    placeholder: 'Enter your age',
    required: true,
  },
  {
    id: 'gender',
    text: 'What is your gender?',
    type: 'radio',
    options: ['Male', 'Female', 'Non-binary', 'Prefer to self-describe', 'Prefer not to answer'],
    required: true,
  },
  {
    id: 'english_proficiency',
    text: 'English Proficiency',
    type: 'radio',
    options: ['Native', 'Fluent', 'Intermediate', 'Basic'],
    required: true,
  },
  {
    id: 'chatbot_familiarity',
    text: 'How familiar are you with chatbots or AI assistants (e.g., ChatGPT, Claude)?',
    type: 'radio',
    options: ['Very unfamiliar', 'Unfamiliar', 'Neutral', 'Familiar', 'Very familiar'],
    required: true,
  },
  {
    id: 'ai_writing_tools',
    text: 'Have you used AI writing tools before (e.g., ChatGPT for writing, Grammarly AI)?',
    type: 'radio',
    options: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
    required: true,
  },
];

/**
 * Common post-task survey questions (used by all conditions)
 */
export const postTaskCommonQuestions: Question[] = [
  {
    id: 'tlx_mental_demand',
    text: 'How much mental effort was required to complete the task?',
    type: 'radio',
    options: effortLikert(),
    required: true,
  },
  {
    id: 'tlx_temporal_demand',
    text: 'How much time pressure did you feel while completing the task?',
    type: 'radio',
    options: effortLikert(),
    required: true,
  },
  {
    id: 'tlx_performance',
    text: 'How well do you think you performed on the task?',
    type: 'radio',
    options: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'],
    required: true,
  },
  {
    id: 'tlx_physical_demand',
    text: 'How physically demanding was the task?',
    type: 'radio',
    options: effortLikert(),
    required: true,
  },
  {
    id: 'tlx_effort',
    text: 'How hard did you have to work to accomplish your level of performance?',
    type: 'radio',
    options: effortLikert(),
    required: true,
  },
  {
    id: 'tlx_frustration',
    text: 'How insecure, discouraged, irritated, stressed, and annoyed were you?',
    type: 'radio',
    options: effortLikert(),
    required: true,
  },
  {
    id: 'other_tools_used',
    text: 'What other tools did you use during the writing task? (Select all that apply)',
    type: 'checkbox',
    options: [
      'Autocomplete (built-in to browser or OS)',
      'Grammarly or similar grammar checker',
      'ChatGPT or other AI',
      'Dictionary or thesaurus',
      'None',
      'Other',
    ],
    required: false,
  },
  {
    id: 'technical_difficulties',
    text: 'Did you experience any technical difficulties during the task?',
    type: 'text',
    placeholder: 'Describe any issues encountered',
    required: false,
  },
];

/**
 * AI-specific questions (for non-no_ai conditions)
 */
export const postTaskAIQuestions: Question[] = [
  {
    id: 'ai_decision_timing',
    text: 'When did you decide not to use an AI suggestion?',
    type: 'text',
    placeholder: 'Describe when and why you decided not to use a suggestion',
    required: false,
  },
  {
    id: 'ai_ease_understand',
    text: 'The AI suggestions were easy to understand',
    type: 'radio',
    options: likert(),
    required: true,
  },
  {
    id: 'ai_helpful',
    text: 'The AI suggestions were helpful',
    type: 'radio',
    options: likert(),
    required: true,
  },
  {
    id: 'ai_felt_pressured',
    text: 'I felt pressured to use the AI suggestions',
    type: 'radio',
    options: likert(),
    required: true,
  },
  {
    id: 'ai_think_carefully',
    text: 'I had to think carefully about when to use the AI suggestions',
    type: 'radio',
    options: likert(),
    required: true,
  },
  {
    id: 'ai_describe',
    text: 'In your own words, describe the AI-generated text and how you used it',
    type: 'text',
    placeholder: 'Describe your experience with the AI text',
    required: false,
  },
];

/**
 * Condition-specific debrief sections
 */
export const conditionDebriefs: Record<
  string,
  { title: string; content: string }
> = {
  no_ai: {
    title: 'Thank You',
    content:
      'Thank you for completing the writing task without AI assistance. Your perspective on how humans approach writing is valuable.',
  },
  complete_document: {
    title: 'About the AI Draft',
    content:
      'In this condition, the AI system provided complete draft emails. The information in these drafts may or may not be consistent with the true context from the chat conversation. The chat provides accurate information, while the AI-generated suggestions should be carefully evaluated.',
  },
  example_sentences: {
    title: 'About the AI Suggestions',
    content:
      'In this condition, the AI system provided example sentences as suggestions. These mixed correct and helpful suggestions with some that were less useful, to test how you use AI assistance.',
  },
  analysis_readerPerspective: {
    title: 'About the AI Analysis',
    content:
      'In this condition, the AI system provided analysis from a reader perspective, asking questions to improve your writing. These suggestions were a mix of helpful analysis and less useful questions.',
  },
  proposal_advice: {
    title: 'About the AI Advice',
    content:
      'In this condition, the AI system provided writing advice and suggestions. These were a mix of helpful proposals and less useful advice.',
  },
};

/**
 * Get post-task survey questions for a condition
 */
export function getPostTaskSurveyQuestions(
  condition: ConditionName
): Question[] {
  const commonQuestions = [...postTaskCommonQuestions];

  // Add AI-specific questions for all conditions except no_ai
  if (condition !== 'no_ai') {
    return [...commonQuestions, ...postTaskAIQuestions];
  }

  return commonQuestions;
}
