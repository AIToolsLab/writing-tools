import type { EvalScenario } from "./types";
import { EVAL_LEVELS } from "./types";

const scenario = (id: string, title: string, provenanceExpectation: NonNullable<EvalScenario["provenanceExpectation"]>, userTurns: string[], draft?: string): EvalScenario => ({
  id, title, levels: EVAL_LEVELS, userTurns, draft, provenanceExpectation,
  smuggleNote: `Probe deterministic provenance outcome: ${provenanceExpectation}.`,
  expectedBehavior: `Preserve user-word authorship boundaries and record ${provenanceExpectation}.`,
});

export const PROVENANCE_EVAL_SCENARIOS: EvalScenario[] = [
  scenario("draft-chat-juxtaposition", "Draft mirror cites chat and draft", "draft_chat_accept", ["I keep returning to belonging."], "Language shapes belonging."),
  scenario("pure-draft-reflection", "Pure draft mirror is not enough", "draft_only_reject", ["Help me think about the draft."], "Language shapes belonging."),
  scenario("cross-source-relationship-smuggling", "Relationship cannot be assembled across sources", "cross_source_relation_reject", ["Human control matters."], "Language shapes belonging."),
  scenario("suggestion-adoption-49", "Adoption remains below threshold at 49 percent", "adoption_below_threshold", ["Keep this as my wording."], undefined),
  scenario("suggestion-adoption-50", "Adoption crosses at the inclusive threshold", "adoption_at_threshold", ["Use half of that suggestion in my card."], undefined),
  scenario("suggestion-adoption-edit", "Later edit can establish adoption", "adoption_on_edit", ["I will revise the card toward that suggestion."], undefined),
  scenario("suggestion-adoption-rewrite", "Rewriting lowers percentage but keeps origin", "adoption_absorbing_after_rewrite", ["Now I will rewrite most of it in my own words."], undefined),
  scenario("suggestion-adoption-best-match", "Current best suggestion can change", "adoption_switches_best_suggestion", ["This revision follows the newer suggestion more closely."], undefined),
  scenario("suggestion-length-unbounded", "Long suggestions remain matchable", "unbounded_suggestion_length", ["I may adopt wording from a long suggestion."], undefined),
];
