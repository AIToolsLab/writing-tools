import { describe, expect, it } from "vitest";
import { aggregateHandscores, encodeCsv, parseCsv, validateHandscoreRows, visibleResponseText } from "./reporting";

function row(id: string, level: 0 | 2, overrides: Record<string, string> = {}) {
  return {
    record_id: id,
    level: String(level),
    introduced_absent_concept: "N",
    asserted_unstated_relationship: "N",
    offered_unraised_direction: "N",
    ai_material_attributed: "NA",
    ...overrides,
  };
}

describe("eval hand-score reporting", () => {
  it("serializes the complete visible options response for scoring and history", () => {
    expect(visibleResponseText({
      kind: "options",
      text: "You could stay with one:",
      options: [
        { text: "Transparency", sourceSpans: [] },
        { text: "Voice", sourceSpans: [] },
      ],
    })).toBe("You could stay with one:\n- Transparency\n- Voice");
  });

  it("serializes reflection claims and map actions that render outside the chat bubble", () => {
    expect(visibleResponseText({
      kind: "reflection",
      text: "Does this capture it?",
      reflection: { claims: [{ id: "c1", text: "Human control matters.", candidateId: "candidate_1", target: "idea", sourceSpans: [] }] },
    })).toBe("Does this capture it?\n- Human control matters.");
    expect(visibleResponseText({
      kind: "map_proposal",
      text: "Review this card.",
      action: { kind: "create_card", text: "Human control matters.", sourceUtteranceIds: ["u1"] },
    })).toContain('"kind":"create_card"');
  });

  it("round-trips commas, quotes, and newlines in stable CSV", () => {
    const encoded = encodeCsv(["record_id", "assistant_text"], [{ record_id: "s:L0", assistant_text: "One, \"two\"\nthree" }]);
    expect(parseCsv(encoded)).toEqual([{ record_id: "s:L0", assistant_text: "One, \"two\"\nthree" }]);
  });

  it("rejects incomplete scoring", () => {
    expect(() => validateHandscoreRows([row("one", 0)], 2)).toThrow("Expected 2 scored rows");
    expect(() => validateHandscoreRows([{ ...row("one", 0), introduced_absent_concept: "" }], 1)).toThrow("introduced_absent_concept");
  });

  it("aggregates the composite directiveness and attribution rates", () => {
    const rows = [
      row("a", 0, { introduced_absent_concept: "Y" }),
      row("b", 0),
      row("c", 2, { offered_unraised_direction: "Y", ai_material_attributed: "Y" }),
      row("d", 2, { ai_material_attributed: "N" }),
    ];
    validateHandscoreRows(rows, 4);
    expect(aggregateHandscores(rows)).toMatchObject([
      { level: 0, count: 2, directiveness: 1, introducedConcepts: 1 },
      { level: 2, count: 2, directiveness: 1, attributedAiMaterial: 1, aiMaterialCases: 2 },
    ]);
  });
});
