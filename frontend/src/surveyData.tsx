// From https://github.com/kcarnold/textrec/blob/master/src/frontend/src/SurveyData.js

import { likert, agreeLikert, QuestionType } from "./surveyViews";

export const otherMid: QuestionType = {
  text:
    "Any other comments? (There will be more surveys before the end of the experiment.)",
  responseType: "text",
  name: "other",
  optional: true,
  flags: { multiline: true },
};

/*
const postTaskBaseQuestions = [
  {
    text: "How would you describe your thought process while writing?",
    responseType: "text",
    name: "thoughtProcess",
    flags: { multiline: true },
  },
  {
    text:
      "How would you describe the shortcuts that the keyboard gave -- what they were and how you used them (or didn't use them)?",
    responseType: "text",
    name: "shortcuts",
    flags: { multiline: true },
  },

  {
    text:
      "Compared with the experience you were writing about, the shortcuts that the keyboard gave were usually...",
    responseType: "options",
    name: "sentimentManipCheck",
    options: ["More negative", "More positive", "Mixed", "Neutral"],
  },
];
*/

export const tlxQuestions: QuestionType[] = [
  likert("mental", "How mentally demanding was the task?", 7, [
    "Very low",
    "Very high",
  ]),
  likert("physical", "How physically demanding was the task?", 7, [
    "Very low",
    "Very high",
  ]),
  likert("temporal", "How hurried or rushed was the pace of the task?", 7, [
    "Very low",
    "Very high",
  ]),
  likert(
    "performance",
    "How successful were you in accomplishing what you were asked to do?",
    7,
    ["Perfect \u{1F601}", "Failure \u{1F641}"]
  ),
  likert(
    "effort",
    "How hard did you have to work to accomplish your level of performance?",
    7,
    ["Very low", "Very high"]
  ),
  likert(
    "frustration",
    "How insecure, discouraged, irritated, stressed, and annoyed were you?",
    7,
    ["Very low", "Very high"]
  ),
];

export const personalityHeader = {
  text: (
    <p>
      Describe yourself as you generally are now, not as you wish to be in the
      future. Describe yourself as you honestly see yourself, in relation to
      other people you know of the same sex as you are, and roughly your same
      age. So that you can describe yourself in an honest manner, your responses
      will be kept in absolute confidence.
    </p>
  ),
};

export const traitQuestion = ({ item }: { item: string }) => ({
  text: item,
  name: item,
  responseType: "likert",
  options: ["Very Inaccurate", "", "", "", "Very Accurate"],
});

export const selfEfficacy = (name: string, text: string) =>
  likert(`efficacy-${name}`, <span>How confident are you {text}?</span>, 7, [
    "Not confident at all",
    "Very confident",
  ]);

export const verbalized_during = {
  text:
    "While you were writing, did you speak or whisper what you were writing?",
  responseType: "options",
  name: "verbalized_during",
  options: ["Yes", "No"],
};

export const numericResponse = ({ name, text }: { name: string, text: string }) => ({
  responseType: "text",
  flags: { type: "number" },
  text,
  name,
});

export const age = numericResponse({
  text: "How old are you?",
  name: "age",
});

export const gender = {
  text: "What is your gender?",
  responseType: "text",
  name: "gender",
};

export const english_proficiency = {
  text:
    "How proficient would you say you are in English? (Be honest, no penalty here!)",
  responseType: "options",
  name: "english_proficiency",
  options: ["Basic", "Conversational", "Fluent", "Native or bilingual"],
};

export const chatbotFamiliar: QuestionType = likert(
  "chatbotFamiliar",
  "How familiar are you with AI chatbots such as ChatGPT, Google Gemini, Microsoft Copilot and other similar platforms?",
  5,
  ["Not familiar at all", "Extremely familiar"]
);


/*
      Generating portions of text (e.g. using ChatGPT, Google Gemini, Microsoft Copilot)         Writing with auto-completion (e.g. Grammarly, Google Docs/MS Word text prediction)         Writing with auto-correction (e.g. Grammarly, Google Docs/MS Word text correction)         Using smart replies (e.g. Gmail, Microsoft Outlook)         Others (Please specify below, in adequate detail)               
        */

export const aiWritingTools: QuestionType[] = [
  {
    text: "How often do you use the following kinds of AI writing tools?"
  },
  likert("generatingText", "Generating portions of text (e.g. using ChatGPT, Google Gemini, Microsoft Copilot)", 5, ["Never", "Very frequently"]),
  likert("autoCorrection", "Writing with correction suggestions (e.g. Grammarly, Google Docs/MS Word text correction)", 5, ["Never", "Very frequently"]),
  likert("autoCompletion", "Writing with completion suggestions (e.g. Grammarly, Google Docs/MS Word text prediction)", 5, ["Never", "Very frequently"]),
  likert("smartReplies", "Using 'smart replies' (e.g. complete-message suggestions in Gmail or Microsoft Outlook)", 5, ["Never", "Very frequently"]),
  {
    text: "Briefly describe any other use of AI writing tools",
    responseType: "text",
    name: "otherAIWritingTools",
    optional: true,
    flags: { multiline: true, placeholder: "optional" },
  }
]



export const techDiff = {
  text:
    "Did you experience any technical difficulties that you haven't reported already?",
  responseType: "text",
  name: "techDiff",
  optional: true,
  flags: { multiline: true, placeholder: "optional" },
};

export const otherFinal = {
  text:
    "Aaaand... we're done! Any feedback or ideas for us? What went well? What could have been better? You may leave this blank.",
  responseType: "text",
  name: "other",
  optional: true,
  flags: { multiline: true, placeholder: "optional" },
};

/*
export const shortNFC = [
  ["I would prefer complex to simple problems", true],
  [
    "I like to have the responsibility of handling a situation that requires a lot of thinking",
    true,
  ],
  ["Thinking is not my idea of fun", false],
  [
    "I would rather do something that requires little thought than something that is sure to challenge my thinking abilities",
    false,
  ],
].map(([text, normalCoded], idx) =>
  agreeLikert(`nfc${idx}_${normalCoded ? "norm" : "rev"}`, text, 5)
);
*/
