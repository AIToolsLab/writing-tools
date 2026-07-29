import { describe, expect, it } from "vitest";
import { DRAFT_FOCUS_EVAL_SCENARIOS } from "./draft-focus";

describe("draft-focus eval scenario fixtures", () => {
  it("covers the six agreed focus and anchor judgments at L0 and L2", () => {
    expect(DRAFT_FOCUS_EVAL_SCENARIOS).toHaveLength(6);
    for (const scenario of DRAFT_FOCUS_EVAL_SCENARIOS) {
      expect(scenario.levels).toEqual([0, 2]);
      expect(scenario.draft.trim()).not.toBe("");
      expect(scenario.dialogue.at(-1)?.role).toBe("user");
    }
  });

  it("uses exact draft wording for explicit user selection", () => {
    const selected = DRAFT_FOCUS_EVAL_SCENARIOS.find((scenario) => scenario.selectedPassage);
    expect(selected).toBeDefined();
    expect(selected!.draft.includes(selected!.selectedPassage!)).toBe(true);
    expect(selected!.anchorGuidance).toBe("prefer");
  });
});
