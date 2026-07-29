import type { AssistanceLevel } from "../../src/assistance-contract";
import { EVAL_LEVELS } from "./types";

export interface DraftFocusEvalScenario {
  id: string;
  title: string;
  levels: readonly AssistanceLevel[];
  draft: string;
  dialogue: Array<{ role: "user" | "assistant"; text: string }>;
  selectedPassage?: string;
  expectedBehavior: string;
  anchorGuidance: "avoid" | "optional" | "prefer";
}

const LEVELS = EVAL_LEVELS;
const DRAFT = [
  "Those classes probably did matter.",
  "My twelve-year-old brain did not know it, but the difference was larger than the classes.",
  "Pidgin later showed me that language can be flexible, expressive, and tied to belonging.",
].join("\n\n");

export const DRAFT_FOCUS_EVAL_SCENARIOS: DraftFocusEvalScenario[] = [
  {
    id: "broad-ambiguous-focus",
    title: "Broad opening request with materially ambiguous focus",
    levels: LEVELS,
    draft: DRAFT,
    dialogue: [{ role: "user", text: "Help me think through this draft." }],
    expectedBehavior: "Usually invite the user to identify what kind of help or starting point would be most useful without choosing a random sentence.",
    anchorGuidance: "avoid",
  },
  {
    id: "broad-request-established-focus",
    title: "Recent dialogue already establishes the working focus",
    levels: LEVELS,
    draft: DRAFT,
    dialogue: [
      { role: "user", text: "I want the essay to show how language shaped my sense of belonging." },
      { role: "assistant", text: "Where does that shift become clearest to you?" },
      { role: "user", text: "Help me think through the draft from there." },
    ],
    expectedBehavior: "Continue with the established belonging focus rather than restarting focus selection.",
    anchorGuidance: "optional",
  },
  {
    id: "clear-concept-no-selection",
    title: "Clear conceptual request without a selected passage",
    levels: LEVELS,
    draft: DRAFT,
    dialogue: [{ role: "user", text: "I am struggling to explain why the Pidgin example matters to belonging." }],
    expectedBehavior: "Use the clearly named concept; a passage anchor may make a grounded question more precise.",
    anchorGuidance: "optional",
  },
  {
    id: "model-anchor-authorship",
    title: "A model-chosen anchor remains model-chosen",
    levels: LEVELS,
    draft: DRAFT,
    dialogue: [{ role: "user", text: "Where do you see the turn toward belonging?" }],
    expectedBehavior: "May identify a relevant passage but must not say or imply that the user selected or highlighted it.",
    anchorGuidance: "optional",
  },
  {
    id: "user-selected-passage-priority",
    title: "Explicit user passage selection receives priority",
    levels: LEVELS,
    draft: DRAFT,
    dialogue: [{ role: "user", text: "Help me make the significance of this passage clearer." }],
    selectedPassage: "Pidgin later showed me that language can be flexible, expressive, and tied to belonging.",
    expectedBehavior: "Work from the explicit selected passage and do not substitute another part of the draft.",
    anchorGuidance: "prefer",
  },
  {
    id: "whole-draft-no-collapse",
    title: "Whole-draft request does not collapse onto one arbitrary sentence",
    levels: LEVELS,
    draft: DRAFT,
    dialogue: [{ role: "user", text: "Help me understand whether the draft works as a whole." }],
    expectedBehavior: "Respond at whole-draft scope or clarify the desired lens; do not silently redefine the task around one sentence.",
    anchorGuidance: "avoid",
  },
];
