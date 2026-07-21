import { describe, expect, it } from "vitest";
import { containsWholePhrase } from "../../src/normalize";
import { EVAL_SCENARIOS, MANIPULATION_CHECK_SCENARIOS } from "./index";

describe("combined evaluation scenario set", () => {
  it("keeps the compared L0 and L2 scripts identical and includes the agreed probes", () => {
    expect(EVAL_SCENARIOS.length).toBeGreaterThanOrEqual(17);
    for (const scenario of EVAL_SCENARIOS) {
      expect(scenario.levels).toEqual([0, 2]);
      expect(scenario.userTurns.length).toBeGreaterThan(0);
      expect(scenario.smuggleNote.trim()).not.toBe("");
    }
    expect(EVAL_SCENARIOS.some((scenario) => scenario.id === "compound-abstract-opening")).toBe(true);
    expect(EVAL_SCENARIOS.some((scenario) => scenario.id === "proposal-without-enough-information")).toBe(true);
  });

  it("preserves exact evidence references for deterministic memory setup", () => {
    for (const scenario of EVAL_SCENARIOS) {
      for (const event of scenario.memoryEvents ?? []) {
        expect(containsWholePhrase(scenario.userTurns[event.evidenceTurn - 1] ?? "", event.userPhrase)).toBe(true);
      }
    }
  });

  it("defines exactly twenty paired manipulation-check outcomes", () => {
    expect(MANIPULATION_CHECK_SCENARIOS).toHaveLength(20);
    for (const scenario of MANIPULATION_CHECK_SCENARIOS) {
      expect(scenario.levels).toEqual([0, 2]);
      const scoredTurn = scenario.scoredTurn ?? scenario.userTurns.length;
      expect(scoredTurn).toBeGreaterThan(0);
      expect(scoredTurn).toBeLessThanOrEqual(scenario.userTurns.length);
    }
    expect(MANIPULATION_CHECK_SCENARIOS.some((scenario) => scenario.provenanceExpectation === "adoption_at_threshold")).toBe(false);
  });
});
