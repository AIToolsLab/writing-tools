import { describe, expect, it } from "vitest";

import { contractFor } from "./contracts";
import { gateTurn } from "./contract-gate";
import type { LLMTurn } from "./llm-contract";

function turn(partial: Partial<LLMTurn>): LLMTurn {
  return { mode: "question", text: "…", ...partial };
}

describe("gateTurn", () => {
  it("L0 rejects an inferred attribution and forces asserted", () => {
    const { turn: gated, rejections } = gateTurn(
      turn({ kind: "reflection", attribution: "inferred" }),
      contractFor(0),
    );
    expect(gated.attribution).toBe("asserted");
    expect(rejections.map((r) => r.reason)).toContain("attribution_not_allowed");
  });

  it("L0 rejects a suggestion kind and downgrades to question", () => {
    const { turn: gated, rejections } = gateTurn(
      turn({ kind: "suggestion", attribution: "asserted" }),
      contractFor(0),
    );
    expect(gated.kind).toBe("question");
    expect(rejections.map((r) => r.reason)).toContain("kind_not_allowed");
  });

  it("L0 rejects an options kind (grounded options is a Level 1 addition)", () => {
    const { turn: gated, rejections } = gateTurn(
      turn({ kind: "options", attribution: "asserted" }),
      contractFor(0),
    );
    expect(gated.kind).toBe("question");
    expect(rejections).toHaveLength(1);
  });

  it("L1 allows options but still rejects inferred", () => {
    const bank = [{ text: "the writer chooses every word" }];
    const { turn: gated, rejections } = gateTurn(
      turn({ kind: "options", attribution: "inferred", options: [{ text: "the writer chooses" }] }),
      contractFor(1),
      bank,
    );
    expect(gated.kind).toBe("options");
    expect(gated.attribution).toBe("asserted");
    expect(rejections.map((r) => r.reason)).toEqual(["attribution_not_allowed"]);
  });

  it("L2 accepts an inferred suggestion untouched", () => {
    const { turn: gated, rejections } = gateTurn(
      turn({ kind: "suggestion", attribution: "inferred" }),
      contractFor(2),
    );
    expect(gated.kind).toBe("suggestion");
    expect(gated.attribution).toBe("inferred");
    expect(rejections).toHaveLength(0);
  });

  it("a mirror-mode turn with no kind falls back to reflection, allowed at every level", () => {
    for (const level of [0, 1, 2] as const) {
      const { turn: gated, rejections } = gateTurn(
        turn({ mode: "mirror" }),
        contractFor(level),
      );
      expect(gated.kind).toBe("reflection");
      expect(rejections).toHaveLength(0);
    }
  });

  it("L1 keeps verbatim options and drops non-verbatim ones", () => {
    const bank = [{ text: "authorship means the writer chooses every word" }];
    const { turn: gated, rejections } = gateTurn(
      turn({
        kind: "options",
        attribution: "asserted",
        options: [
          { text: "the writer chooses" }, // verbatim substring
          { text: "AI should draft it for you" }, // not in bank
        ],
      }),
      contractFor(1),
      bank,
    );
    expect(gated.kind).toBe("options");
    expect(gated.options?.map((o) => o.text)).toEqual(["the writer chooses"]);
    expect(rejections.map((r) => r.reason)).toContain("options_not_verbatim");
  });

  it("L1 downgrades an options turn to question when no option is verbatim", () => {
    const bank = [{ text: "authorship means the writer chooses" }];
    const { turn: gated, rejections } = gateTurn(
      turn({ kind: "options", attribution: "asserted", options: [{ text: "brand new AI idea" }] }),
      contractFor(1),
      bank,
    );
    expect(gated.kind).toBe("question");
    expect(gated.options).toBeUndefined();
    expect(rejections.map((r) => r.reason)).toEqual(
      expect.arrayContaining(["options_not_verbatim", "kind_not_allowed"]),
    );
  });

  it("L0 and L1 strip an AI-originated suggested card (map stays user-authored)", () => {
    for (const level of [0, 1] as const) {
      const { turn: gated, rejections } = gateTurn(
        turn({ kind: "reflection", attribution: "asserted", suggestedCard: { text: "an AI idea" } }),
        contractFor(level),
      );
      expect(gated.suggestedCard).toBeUndefined();
      expect(rejections.map((r) => r.reason)).toContain("ai_originated_material_forbidden");
    }
  });

  it("L2 keeps an AI-originated suggested card", () => {
    const { turn: gated, rejections } = gateTurn(
      turn({ kind: "suggestion", attribution: "inferred", suggestedCard: { text: "an AI idea" } }),
      contractFor(2),
    );
    expect(gated.suggestedCard).toEqual({ text: "an AI idea" });
    expect(rejections).toHaveLength(0);
  });

  it("reflection and question are legal at every level", () => {
    for (const level of [0, 1, 2] as const) {
      for (const kind of ["reflection", "question", "aside", "map_proposal"] as const) {
        const { rejections } = gateTurn(turn({ kind, attribution: "asserted" }), contractFor(level));
        expect(rejections).toHaveLength(0);
      }
    }
  });
});
