import { describe, expect, it } from "vitest";
import { containsWholePhrase } from "../../src/normalize";
import { RECALL_EVAL_SCENARIOS } from "./recall";

describe("recall eval scenario fixtures", () => {
  it("uses one identical script for L0 and L2", () => {
    expect(RECALL_EVAL_SCENARIOS).toHaveLength(6);
    for (const scenario of RECALL_EVAL_SCENARIOS) expect(scenario.levels).toEqual([0, 2]);
  });

  it("keys every deterministic memory event to exact user evidence", () => {
    for (const scenario of RECALL_EVAL_SCENARIOS) {
      for (const event of scenario.memoryEvents) {
        expect(event.afterUserTurn).toBeGreaterThanOrEqual(event.evidenceTurn);
        expect(containsWholePhrase(scenario.userTurns[event.evidenceTurn - 1] ?? "", event.userPhrase)).toBe(true);
      }
    }
  });
});
