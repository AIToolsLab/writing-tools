import {
  Question,
  SurveySection,
  likert,
  effortLikert,
  confidenceLikert,
  characteristicLikert,
} from './types';
import { ConditionName } from '@/types/study';

/**
 * Intro survey: demographic questions
 */
export const demographicQuestions: Question[] = [
  {
    id: 'age',
    text: 'What is your age?',
    type: 'radio',
    options: ['18-24', '25-34', '35-44', '45-54', '55-64', '65 or older'],
    required: true,
  },
  {
    id: 'education',
    text: 'What is the highest level of education you have completed?',
    type: 'radio',
    options: [
      'Less than secondary/high school',
      'Secondary/high school',
      'Some college or university, but no degree',
      'Vocational or technical qualification',
      'Associate degree or equivalent',
      "Bachelor's degree or equivalent",
      "Master's degree or equivalent",
      'Doctoral (e.g., PhD) or professional degree (e.g., MD, JD) or equivalent',
      'Other (please specify)',
    ],
    otherOption: 'Other (please specify)',
    required: true,
  },
  {
    id: 'employment',
    text: 'What is your current employment status?',
    type: 'radio',
    options: [
      'Employed full-time',
      'Employed part-time',
      'Self-employed',
      'Student',
      'Unemployed',
      'Retired',
      'Other (please specify)',
    ],
    otherOption: 'Other (please specify)',
    required: true,
  },
  {
    id: 'english_native',
    text: 'Is English your native language?',
    type: 'radio',
    options: ['Yes', 'No'],
    required: true,
  },
];

/**
 * Intro survey: email writing experience
 */
export const emailWritingQuestions: Question[] = [
  {
    id: 'email_frequency',
    text: 'How often do you currently write emails for your work, school, or an organization?',
    type: 'radio',
    options: [
      'Never',
      'Less than once a month',
      'At least once a month, but not every week',
      'At least once a week, but not every day',
      'Every day or almost every day',
    ],
    required: true,
  },
  {
    id: 'email_experience_years',
    text: 'How many years of experience do you have writing emails for work, school, or an organization?',
    type: 'radio',
    options: [
      'None',
      'Less than 1 year',
      '1-3 years',
      '4-9 years',
      '10 years or more',
    ],
    required: true,
  },
];

/**
 * Intro survey: AI writing tool usage
 */
export const aiWritingToolQuestions: Question[] = [
  {
    id: 'ai_writing_frequency',
    text: 'How often do you use AI tools for writing tasks (e.g., ChatGPT, Claude, Gemini, Microsoft Copilot, Perplexity AI, Grammarly, Notion AI)?',
    type: 'radio',
    options: [
      'Never',
      'Less than once a month',
      'At least once a month, but not every week',
      'At least once a week, but not every day',
      'Every day or almost every day',
    ],
    required: true,
  },
  {
    id: 'ai_writing_uses',
    text: 'When you use AI tools for writing tasks, what do you typically use them for? Select all that apply.',
    type: 'checkbox',
    options: [
      'Writing a complete draft for me',
      'Suggesting the next word or sentence for me',
      'Revising or editing text I wrote (including checking for grammar and spelling)',
      'Brainstorming ideas',
      'Getting feedback or advice on my writing',
      'Other (please specify)',
      "I don't use AI for writing",
    ],
    otherOption: 'Other (please specify)',
    exclusiveOption: "I don't use AI for writing",
    required: true,
  },
];

/**
 * Intro survey: writing self-efficacy
 * (Self-Efficacy for Writing Scale, adapted from the 9-item version)
 */
export const writingSelfEfficacyQuestions: Question[] = [
  {
    id: 'writing_se_words',
    text: 'I can think of many words to describe my ideas.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_ideas',
    text: 'I can think of many ideas for my writing.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_put_ideas',
    text: 'I can put my ideas into writing.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_sentences',
    text: 'I can write complete sentences.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_punctuation',
    text: 'I can punctuate my sentences correctly.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_spelling',
    text: 'I can spell my words correctly.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_concentrate',
    text: 'I can concentrate on my writing for a long time.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_distractions',
    text: 'I can avoid distractions when I write.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
  {
    id: 'writing_se_persist',
    text: 'I can keep writing even when it is difficult.',
    type: 'likert',
    options: confidenceLikert(),
    required: true,
  },
];

/**
 * Intro survey: Need for Cognition Scale (NCS-6, items in original order).
 * ncs_3 and ncs_4 are reverse-scored.
 */
export const needForCognitionQuestions: Question[] = [
  {
    id: 'ncs_1',
    text: 'I would prefer complex to simple problems.',
    type: 'likert',
    options: characteristicLikert(),
    required: true,
  },
  {
    id: 'ncs_2',
    text: 'I like to have the responsibility of handling a situation that requires a lot of thinking.',
    type: 'likert',
    options: characteristicLikert(),
    required: true,
  },
  {
    id: 'ncs_3',
    text: 'Thinking is not my idea of fun.',
    type: 'likert',
    options: characteristicLikert(),
    required: true,
  },
  {
    id: 'ncs_4',
    text: 'I would rather do something that requires little thought than something that is sure to challenge my thinking abilities.',
    type: 'likert',
    options: characteristicLikert(),
    required: true,
  },
  {
    id: 'ncs_5',
    text: 'I really enjoy a task that involves coming up with new solutions to problems.',
    type: 'likert',
    options: characteristicLikert(),
    required: true,
  },
  {
    id: 'ncs_6',
    text: 'I would prefer a task that is intellectual, difficult, and important to one that is somewhat important but does not require much thought.',
    type: 'likert',
    options: characteristicLikert(),
    required: true,
  },
];

/**
 * Intro survey, grouped into titled sections
 */
export const introSurveySections: SurveySection[] = [
  { title: 'Demographic Questions', questions: demographicQuestions },
  {
    title: 'Email Writing Experience Questions',
    questions: emailWritingQuestions,
  },
  {
    title: 'AI Writing Tool Usage Questions',
    questions: aiWritingToolQuestions,
  },
  {
    title: 'Self-Efficacy for Writing Scale',
    description:
      'For each of the following statements, please indicate how confident you are in your ability to do what is described.',
    questions: writingSelfEfficacyQuestions,
  },
  {
    title: 'Need for Cognition Scale Questions',
    description:
      'Please indicate how characteristic each of the following statements is of you.',
    questions: needForCognitionQuestions,
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
      'Other (please specify in the next question)',
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
    text: (
      <>
        Can you recall a specific moment when you read a suggestion and decided
        not to use it? What made you decide that? Be as specific as you can.
      </>
    ),
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
      'In this condition, the AI system provided complete draft emails. The information in these drafts may or may not have been consistent with the true context from the chat conversation. Please reflect on how you used these AI-generated drafts in your writing.',
  },
  example_sentences: {
    title: 'About the AI Suggestions',
    content:
      'In this condition, the AI system provided example sentences as suggestions. The information in these suggestions may or may not have been consistent with the true context from the chat conversation. Please reflect on how you used these AI-generated suggestions in your writing.',
  },
  analysis_readerPerspective: {
    title: 'About the AI Analysis',
    content:
      'In this condition, the AI system provided analysis from a reader perspective. Please reflect on how this feedback influenced your writing process.',
  },
  proposal_advice: {
    title: 'About the AI Advice',
    content:
      'In this condition, the AI system provided writing advice and suggestions. Please reflect on how this advice influenced your writing process.',
  },
};

/**
 * Get post-task survey questions for a condition
 */
export function getPostTaskSurveyQuestions(
  condition: ConditionName,
): Question[] {
  const commonQuestions = [...postTaskCommonQuestions];

  // Add AI-specific questions for all conditions except no_ai
  if (condition !== 'no_ai') {
    return [...commonQuestions, ...postTaskAIQuestions];
  }

  return commonQuestions;
}
