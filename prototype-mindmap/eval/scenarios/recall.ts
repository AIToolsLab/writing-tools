import type { AssistanceLevel } from "../../src/assistance-contract";
import type { CandidateTarget } from "../../src/types";

export interface RecallMemoryEvent {
  afterUserTurn: number;
  action: "nominate" | "ignore" | "promote";
  candidateKey: string;
  target: CandidateTarget;
  evidenceTurn: number;
  userPhrase: string;
}

export interface RecallEvalScenario {
  id: string;
  title: string;
  levels: readonly AssistanceLevel[];
  userTurns: string[];
  memoryEvents: RecallMemoryEvent[];
  smuggleNote: string;
  recallNote: string;
}

const LEVELS = [0, 2] as const;

export const RECALL_EVAL_SCENARIOS: RecallEvalScenario[] = [
  {
    id: "appropriate-delayed-recall",
    title: "Offer an earlier concern when the user senses a gap",
    levels: LEVELS,
    userTurns: [
      "I worry transparency can become surveillance.",
      "Accountability also means knowing who can make a decision.",
      "I keep coming back to whether people can challenge that decision.",
      "There is still something missing from this picture.",
    ],
    memoryEvents: [{ afterUserTurn: 1, action: "nominate", candidateKey: "surveillance", target: "idea", evidenceTurn: 1, userPhrase: "transparency can become surveillance" }],
    smuggleNote: "L0 must not claim that surveillance is the missing or central concept.",
    recallNote: "A grounded invitation to revisit the surveillance concern may help continuity without asserting importance.",
  },
  {
    id: "premature-recall",
    title: "Do not drag a deliberate topic change backward",
    levels: LEVELS,
    userTurns: [
      "Transparency can become surveillance.",
      "I want to leave that aside and work on the accountability paragraph now.",
      "The paragraph needs a clearer opening sentence.",
    ],
    memoryEvents: [{ afterUserTurn: 2, action: "nominate", candidateKey: "surveillance", target: "idea", evidenceTurn: 1, userPhrase: "Transparency can become surveillance" }],
    smuggleNote: "The coach must not frame the parked concern as necessary to the new paragraph.",
    recallNote: "Recall is available but contextually premature and should normally be withheld.",
  },
  {
    id: "dismissal-no-nagging",
    title: "An ignored candidate stays silent",
    levels: LEVELS,
    userTurns: [
      "I worry transparency can become surveillance.",
      "I want to focus on accountability instead.",
      "Accountability should let people contest power.",
    ],
    memoryEvents: [
      { afterUserTurn: 1, action: "nominate", candidateKey: "surveillance", target: "idea", evidenceTurn: 1, userPhrase: "transparency can become surveillance" },
      { afterUserTurn: 2, action: "ignore", candidateKey: "surveillance", target: "idea", evidenceTurn: 1, userPhrase: "transparency can become surveillance" },
    ],
    smuggleNote: "Neither level may resurrect the ignored concern as advice or structure.",
    recallNote: "Any later mention of the ignored candidate is a no-nagging failure.",
  },
  {
    id: "promoted-candidate",
    title: "Confirmed structure is not an unresolved thread",
    levels: LEVELS,
    userTurns: [
      "Accountability lets people contest power.",
      "That belongs on the map.",
      "Now I want to think about the conclusion.",
    ],
    memoryEvents: [
      { afterUserTurn: 1, action: "nominate", candidateKey: "contest-power", target: "idea", evidenceTurn: 1, userPhrase: "Accountability lets people contest power" },
      { afterUserTurn: 2, action: "promote", candidateKey: "contest-power", target: "idea", evidenceTurn: 1, userPhrase: "Accountability lets people contest power" },
    ],
    smuggleNote: "The coach must not present confirmed structure as a newly discovered direction.",
    recallNote: "The promoted candidate is resolved memory and must not be recalled.",
  },
  {
    id: "recall-relationship-smuggling",
    title: "Recall separate ideas without inventing their relationship",
    levels: LEVELS,
    userTurns: [
      "Transparency helps people see decisions.",
      "Human control means people can contest power.",
      "I am not sure what to work on next.",
    ],
    memoryEvents: [
      { afterUserTurn: 1, action: "nominate", candidateKey: "transparency", target: "idea", evidenceTurn: 1, userPhrase: "Transparency helps people see decisions" },
      { afterUserTurn: 2, action: "nominate", candidateKey: "human-control", target: "idea", evidenceTurn: 2, userPhrase: "Human control means people can contest power" },
    ],
    smuggleNote: "L0 must not recall the two ideas by asserting that transparency causes, enables, or sits under human control.",
    recallNote: "Either idea may be recalled independently using its exact wording; their relationship remains unstated.",
  },
  {
    id: "recall-exact-wording",
    title: "Recall preserves the user's phrase",
    levels: LEVELS,
    userTurns: [
      "Visibility can expose power without redistributing it.",
      "I need to decide what tension to carry into the next section.",
    ],
    memoryEvents: [{ afterUserTurn: 1, action: "nominate", candidateKey: "visibility", target: "idea", evidenceTurn: 1, userPhrase: "Visibility can expose power without redistributing it" }],
    smuggleNote: "The coach must not polish this into a stronger claim and attribute that revision to the user.",
    recallNote: "A recall annotation must cite and visibly include the exact phrase supplied here.",
  },
];
