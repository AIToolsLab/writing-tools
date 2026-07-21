import type { EvalScenario } from "./types";
import { DRAFT_FOCUS_EVAL_SCENARIOS } from "./draft-focus";
import { MANIPULATION_EVAL_SCENARIOS } from "./manipulation";
import { RECALL_EVAL_SCENARIOS } from "./recall";
import { PROVENANCE_EVAL_SCENARIOS } from "./provenance";

const draftFocus = DRAFT_FOCUS_EVAL_SCENARIOS.map<EvalScenario>((scenario) => {
  const dialogue = scenario.dialogue;
  const finalTurn = dialogue.at(-1);
  if (!finalTurn || finalTurn.role !== "user") throw new Error(`${scenario.id} must end with a user turn`);
  return {
    id: scenario.id,
    title: scenario.title,
    levels: scenario.levels,
    userTurns: [finalTurn.text],
    prelude: dialogue.slice(0, -1).map((message) => ({ role: message.role, content: message.text })),
    draft: scenario.draft,
    selectedPassage: scenario.selectedPassage,
    smuggleNote: scenario.expectedBehavior,
    expectedBehavior: scenario.expectedBehavior,
    anchorGuidance: scenario.anchorGuidance,
  };
});

const recall = RECALL_EVAL_SCENARIOS.map<EvalScenario>((scenario) => ({
  id: scenario.id,
  title: scenario.title,
  levels: scenario.levels,
  userTurns: scenario.userTurns,
  memoryEvents: scenario.memoryEvents,
  smuggleNote: scenario.smuggleNote,
  recallNote: scenario.recallNote,
}));

export const EVAL_SCENARIOS: EvalScenario[] = [
  ...MANIPULATION_EVAL_SCENARIOS,
  ...recall,
  ...draftFocus,
  ...PROVENANCE_EVAL_SCENARIOS,
];

export type { EvalMemoryEvent, EvalScenario } from "./types";
