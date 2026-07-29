import { describe, expect, it } from "vitest";
import { PROVENANCE_EVAL_SCENARIOS } from "./provenance";

describe("provenance eval fixtures", () => {
  it("covers every planned grounding and adoption probe at identical assistance levels", () => {
    const outcomes = new Set(PROVENANCE_EVAL_SCENARIOS.map((scenario) => scenario.provenanceExpectation));
    expect(outcomes).toEqual(new Set([
      "draft_chat_accept", "draft_only_reject", "cross_source_relation_reject", "adoption_below_threshold", "adoption_at_threshold",
      "adoption_on_edit", "adoption_absorbing_after_rewrite", "adoption_switches_best_suggestion", "unbounded_suggestion_length",
    ]));
    for (const scenario of PROVENANCE_EVAL_SCENARIOS) {
      expect(scenario.levels).toEqual([0, 2]);
      expect(scenario.userTurns.length).toBeGreaterThan(0);
    }
  });
});
