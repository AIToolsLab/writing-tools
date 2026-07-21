import { describe, expect, it } from "vitest";
import { bestSuggestionMatch, reconcileSuggestionAdoption } from "./suggestion-adoption";
import type { ThoughtUnit } from "./types";

function unit(text: string, origin: ThoughtUnit["source"]["origin"] = "user_canvas"): ThoughtUnit {
  return { id: "tu_1", text, role: "node", source: { utteranceIds: [], createdBy: "user", origin }, roleHistory: [] };
}

describe("suggestion adoption", () => {
  it("uses distinct stemmed content words and ignores duplicates and stopwords", () => {
    expect(bestSuggestionMatch("Organizing organized ideas and ideas", [{ id: 1, text: "organize ideas" }])).toMatchObject({ overlapRatio: 1 });
  });

  it("returns zero for empty content", () => {
    expect(bestSuggestionMatch("the and it", [{ id: 1, text: "anything" }])).toEqual({ overlapRatio: 0, matchedStems: [], cardStems: [] });
  });

  it("breaks equal matches toward the most recent suggestion", () => {
    expect(bestSuggestionMatch("human control", [{ id: 2, text: "human" }, { id: 7, text: "control" }]).messageId).toBe(7);
  });

  it("keeps 49 percent below threshold and accepts exactly 50 percent", () => {
    const stems49 = Array.from({ length: 51 }, (_, index) => `token${index}`).join(" ");
    const suggestion49 = Array.from({ length: 25 }, (_, index) => `token${index}`).join(" ");
    expect(reconcileSuggestionAdoption(unit(stems49), [{ id: 1, text: suggestion49 }]).source.suggestionAdoption).toBeUndefined();
    expect(reconcileSuggestionAdoption(unit("human control matters deeply"), [{ id: 2, text: "human control" }]).source.suggestionAdoption).toMatchObject({ adoptedFromMessageId: 2, currentOverlapRatio: 0.5 });
  });

  it("is absorbing, recomputes downward, and can switch the current best match", () => {
    const adopted = reconcileSuggestionAdoption(unit("human control"), [{ id: 2, text: "human control" }]);
    const rewritten = reconcileSuggestionAdoption({ ...adopted, text: "human agency differs" }, [{ id: 2, text: "human control" }, { id: 9, text: "agency differs" }]);
    expect(rewritten.source).toMatchObject({
      origin: "ai_suggested",
      suggestionAdoption: { adoptedFromMessageId: 2, currentBestSuggestionMessageId: 9, currentOverlapRatio: 2 / 3, peakOverlapRatio: 1 },
    });
    const below = reconcileSuggestionAdoption({ ...rewritten, text: "entirely original wording" }, [{ id: 2, text: "human control" }, { id: 9, text: "agency differs" }]);
    expect(below.source).toMatchObject({ origin: "ai_suggested", suggestionAdoption: { adoptedFromMessageId: 2, currentOverlapRatio: 0, peakOverlapRatio: 1 } });
  });

  it("upgrades ai_connected provenance when adoption crosses the threshold", () => {
    expect(reconcileSuggestionAdoption(unit("draft idea reframed", "ai_connected"), [{ id: 4, text: "reframe the draft idea" }]).source.origin).toBe("ai_suggested");
  });
});
