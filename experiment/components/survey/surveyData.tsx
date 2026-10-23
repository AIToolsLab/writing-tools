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
 * Post-task general recall questions
 */
export const generalRecallQuestions: Question[] = [
  {
    id: 'general_recall',
    text: 'What decisions do you remember making about what to include or leave out while writing the email? Please describe as many decisions as you can remember, and briefly explain what influenced each one.',
    type: 'text',
    placeholder: 'Describe your decisions and what influenced each one',
    required: true,
  },
];

const specificRecallOptions = [
  'Yes, I remember considering this',
  "I'm not sure",
  "No, I don't remember considering this",
];

/**
 * Cued recall concerns per scenario ID. Each concern is saved as
 * `specific_recall_${key}`.
 */
export const specificRecallConcerns: Record<string, Record<string, string>> = {
  roomDoubleBooking: {
    band_setup_time:
      "Jaden's band may not have enough time to set up their equipment in the new room.",
    delay_conflicts_commitments:
      "Delaying Jaden's panel may conflict with his existing commitments.",
    new_room_readiness:
      'Jaden may be concerned about whether the new room will be ready in time.',
    housekeeping_cleaning:
      'Jaden may have to wait for housekeeping to finish cleaning the new hotel room.',
    room_12_to_14: "Jaden's panel must move from Room 12 to Room 14.",
    new_room_1pm_conflict:
      'The new room cannot accommodate a 1pm start because the preceding event ends at 1pm.',
    already_advertised:
      'Jaden may have already advertised the original time and location to his audience.',
    panel_less_important:
      'Jaden may feel that his panel is being treated as less important because Sophia is more famous.',
    room_double_booked:
      "Jaden's originally scheduled room is no longer available because it was double-booked.",
    reliability_confidence:
      "The last-minute scheduling change may cause Jaden to lose confidence in Meridian Events' reliability.",
  },
  demoRescheduling: {
    bug_delays_stock_launch:
      "A bug in Crestview's automated financial reporting system could significantly delay MediCore's stock launch.",
    demo_tomorrow_2pm:
      'The product demonstration with Dr. Patel is scheduled for tomorrow at 2pm.',
    partial_demo_option:
      'Crestview may be able to demonstrate unaffected software capabilities as scheduled and arrange a separate demonstration of the automated reporting capabilities once the bug is fixed.',
    reporting_unreliable:
      "Crestview's automated reporting capabilities are unreliable because of a bug in the reporting module.",
    delay_limits_transition:
      'Delaying the product demonstration could leave little time for MediCore to transition to a new reporting system before its existing system loses support.',
    bug_affects_interest:
      'The bug affects the automated reporting capabilities that Dr. Patel is particularly interested in seeing.',
    qa_practices_doubt:
      "Discovering a critical bug immediately before the demonstration may cause Dr. Patel to question Crestview's quality assurance practices.",
    fix_takes_3_4_days:
      "Crestview's engineering team needs 3-4 days to fix and test the reporting bug.",
    reschedule_medical_checkups:
      'Dr. Patel will need at least a week to reschedule medical checkups for Crestview employees.',
    fix_vs_vendor_deadline:
      "The time required to fix the reporting bug may conflict with MediCore's deadline for selecting a new software vendor.",
  },
  substituteProduct: {
    e7_supply_delay:
      "Jordan's ErgoFit E7 chairs will not arrive as scheduled because of a supply issue.",
    northline_confidence:
      "The last-minute delivery problem may undermine Jordan's confidence in Northline Office Supply.",
    x9_higher_price:
      'The higher price of the ErgoFit X9 chairs may place an unexpected financial burden on Jordan.',
    dining_room_furnishing:
      'Jordan will be unable to finish furnishing his new dining room on time because of the delivery problem.',
    x9_aesthetic:
      "The different design of the ErgoFit X9 chairs may not match Jordan's intended office aesthetic.",
    business_disruption:
      "The lack of chairs on moving day may disrupt Jordan's business operations.",
    pressure_to_accept:
      "The urgency of Jordan's office move may make him feel pressured to accept substitute chairs that do not fully meet his needs.",
    x9_different_model:
      'The ErgoFit X9 chairs are a different model from what Jordan originally ordered.',
    staff_deliver_to_warehouse:
      "Jordan's staff may not have enough time to deliver the substitute chairs to Northline Office Supply's warehouse.",
    chairs_needed_tomorrow:
      'Jordan needs office chairs ready for his move into a new office tomorrow.',
  },
};

/**
 * Cued recall questions for a scenario
 */
export function getSpecificRecallQuestions(scenarioId: string): Question[] {
  return Object.entries(specificRecallConcerns[scenarioId] ?? {}).map(
    ([key, text]) => ({
      id: `specific_recall_${key}`,
      text,
      type: 'radio',
      options: specificRecallOptions,
      required: true,
    }),
  );
}

/**
 * Open-ended comprehension questions per scenario ID. Each question is saved
 * as `comprehension_${key}`; keys are shared across scenarios.
 */
export const comprehensionQuestionTexts: Record<
  string,
  Record<string, string>
> = {
  roomDoubleBooking: {
    recipient_request:
      'Jaden responds back, asking you for a discount to compensate for his inconvenience. How would you respond, and why?',
    recipient_reactions:
      'What questions or reactions might Jaden have when reading your email? Explain what makes you expect them.',
    new_information:
      'After you send this email, Sophia cancels her panel and asks to reschedule to a different time. What would you need to know before deciding whether to contact Jaden again?',
  },
  demoRescheduling: {
    recipient_request:
      "Dr. Patel responds back, asking if you could offer on-site support to replace their previous vendor's reporting system. How would you respond, and why?",
    recipient_reactions:
      'What questions or reactions might Dr. Patel have when reading your email? Explain what makes you expect them.',
    new_information:
      "After you send this email, you receive an email from the engineering team explaining that an older version of Crestview's software is available for demonstration and doesn't have the critical bug. What would you need to know before deciding whether to contact Dr. Patel again?",
  },
  substituteProduct: {
    recipient_request:
      'Jordan responds back, asking if you could offer the substitute chairs at the same price as the original chairs. How would you respond, and why?',
    recipient_reactions:
      'What questions or reactions might Jordan have when reading your email? Explain what makes you expect them.',
    new_information:
      'After you send your email, the warehouse team informs you that only half of the ErgoFit X9 chairs are actually in stock and available for delivery. What would you need to know before deciding whether to contact Jordan again?',
  },
};

/**
 * Comprehension questions for a scenario
 */
export function getComprehensionQuestions(scenarioId: string): Question[] {
  return Object.entries(comprehensionQuestionTexts[scenarioId] ?? {}).map(
    ([key, text]) => ({
      id: `comprehension_${key}`,
      text,
      type: 'text',
      placeholder: 'Your answer',
      required: true,
    }),
  );
}

/**
 * Colleague drafts to review in the email feedback micro-task, per scenario ID
 */
export const emailFeedbackDrafts: Record<string, string> = {
  roomDoubleBooking: `Hi Jaden,

I hope you're doing well.

I wanted to reach out regarding your scheduled session at 1 p.m. in Room 14. Unfortunately, due to an unexpected scheduling conflict, we recently discovered that Room 14 was accidentally double-booked with another influencer at the same time.

We sincerely apologize for any inconvenience or confusion this may cause. We completely understand that last-minute changes can be frustrating, and we truly appreciate your patience, flexibility, and understanding as we work through this situation.

As a result, we will need to make an adjustment to your room assignment. Our team is currently working to ensure that everything is handled as smoothly as possible and that the transition has minimal impact on your session.

We really appreciate your understanding and cooperation, and we apologize again for the inconvenience. Thank you for bearing with us as we work to resolve this scheduling issue.

Best regards,
Alana Hamilton`,
  demoRescheduling: `Dear Dr. Patel,

I hope this email finds you well.

I wanted to reach out regarding our upcoming product demonstration scheduled for tomorrow at 2 p.m. Unfortunately, due to an unexpected technical issue, we have encountered a problem with our software's reporting functionality that may affect our ability to proceed with the demonstration as originally planned.

We sincerely apologize for any inconvenience or disruption this may cause. We completely understand how important your time is, and we truly appreciate your patience, flexibility, and understanding as our team works diligently to address this issue.

As a result, we may need to make some adjustments to the demonstration schedule. Our engineering team is actively working toward a resolution, and we are doing everything we can to ensure that the demonstration can take place as smoothly and effectively as possible.

We greatly appreciate your continued interest in Crestview Solutions and your understanding during this time. We sincerely apologize again for the inconvenience and look forward to providing you with a demonstration of our software once the issue has been resolved.

Best regards,
James Cox`,
  substituteProduct: `Dear Jordan,

I hope you're doing well.

I wanted to reach out regarding your upcoming office chair delivery scheduled for tomorrow. Unfortunately, due to an unexpected supply issue, we have been informed that the ErgoFit E7 chairs you ordered are experiencing a delay and will not be available for delivery as originally planned.

We sincerely apologize for any inconvenience or disruption this may cause. We completely understand how important it is to have everything ready for your new office, and we truly appreciate your patience, flexibility, and understanding as we work through this situation.

Our team is currently exploring alternative options to help accommodate your needs and minimize any disruption to your office setup. We are committed to finding a suitable resolution and ensuring that your experience with Northline Office Supply remains a positive one.

We genuinely appreciate your understanding and cooperation during this time. Once again, we sincerely apologize for the inconvenience and thank you for bearing with us as we work to resolve this matter.

Best regards,
Keira Thompson`,
};

/**
 * Email feedback micro-task for a scenario: the colleague's draft followed by
 * the feedback prompt
 */
export function getEmailFeedbackQuestions(scenarioId: string): Question[] {
  const draft = emailFeedbackDrafts[scenarioId];
  if (!draft) return [];

  return [
    {
      id: 'email_feedback',
      text: (
        <>
          <span className='block whitespace-pre-line font-normal bg-gray-50 border border-gray-300 rounded p-4 mb-4'>
            {draft}
          </span>
          What feedback would you give your colleague to help them improve the
          email? Provide feedback on any aspects of the email that you think
          could be improved. Your feedback may focus on specific parts of the
          email and/or on the email as a whole. For each suggestion, explain how
          it would help address the situation.
          <span className='block font-normal text-gray-700 mt-3'>
            Reminder: Please do not use writing aids, such as Grammarly or
            ChatGPT, for this task. Standard text-entry features, such as spell
            check and autocomplete, are allowed.
          </span>
        </>
      ),
      type: 'text',
      placeholder: 'Your feedback',
      required: true,
      logChanges: true,
    },
  ];
}

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
 * Get post-task survey sections for a condition and scenario
 */
export function getPostTaskSurveySections(
  condition: ConditionName,
  scenarioId: string,
): SurveySection[] {
  // Add AI-specific questions for all conditions except no_ai
  const experienceQuestions =
    condition !== 'no_ai'
      ? [...postTaskCommonQuestions, ...postTaskAIQuestions]
      : postTaskCommonQuestions;
  const debrief = conditionDebriefs[condition];

  return [
    { title: 'General Recall', questions: generalRecallQuestions },
    {
      title: 'Email Feedback',
      description:
        'Imagine that another colleague was assigned the same writing task you just completed. This time, instead of writing the email yourself, you are reviewing the email your colleague has drafted below.',
      questions: getEmailFeedbackQuestions(scenarioId),
    },
    {
      title: 'Comprehension',
      description:
        'Please answer each of the following questions about hypothetical scenarios related to your email. Treat each scenario independently, and do not assume that information from one scenario applies to another.',
      questions: getComprehensionQuestions(scenarioId),
    },
    {
      title: 'Specific Recall',
      description:
        'Please indicate whether each of the following concerns reflects something you remember considering while writing the email.',
      questions: getSpecificRecallQuestions(scenarioId),
    },
    {
      title: 'Task Experience',
      description: 'Please tell us about your experience with the writing task.',
      intro: debrief && (
        <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
          <h3 className="font-semibold text-blue-900 mb-2">{debrief.title}</h3>
          <p className="text-blue-800 text-sm">{debrief.content}</p>
        </div>
      ),
      questions: experienceQuestions,
    },
  ];
}
