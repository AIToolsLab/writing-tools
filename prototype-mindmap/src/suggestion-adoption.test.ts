import { describe, expect, it } from "vitest";
import { bestSuggestionMatch, reconcileStoreSuggestionAdoption, reconcileSuggestionAdoption } from "./suggestion-adoption";
import type { ThoughtUnit } from "./types";
import { ThoughtUnitStore } from "./map-store";

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
    expect(reconcileSuggestionAdoption(unit(stems49), [{ id: 1, text: suggestion49 }], true).source.suggestionAdoption).toBeUndefined();
    expect(reconcileSuggestionAdoption(unit("human control matters deeply"), [{ id: 2, text: "human control" }], true).source.suggestionAdoption).toMatchObject({ adoptedFromMessageId: 2, currentOverlapRatio: 0.5 });
  });

  it("is absorbing, recomputes downward, and can switch the current best match", () => {
    const adopted = reconcileSuggestionAdoption(unit("human control"), [{ id: 2, text: "human control" }], true);
    const rewritten = reconcileSuggestionAdoption({ ...adopted, text: "human agency differs" }, [{ id: 2, text: "human control" }, { id: 9, text: "agency differs" }]);
    expect(rewritten.source).toMatchObject({
      origin: "ai_suggested",
      suggestionAdoption: { adoptedFromMessageId: 2, currentBestSuggestionMessageId: 9, currentOverlapRatio: 2 / 3, peakOverlapRatio: 1 },
    });
    const below = reconcileSuggestionAdoption({ ...rewritten, text: "entirely original wording" }, [{ id: 2, text: "human control" }, { id: 9, text: "agency differs" }]);
    expect(below.source).toMatchObject({ origin: "ai_suggested", suggestionAdoption: { adoptedFromMessageId: 2, currentOverlapRatio: 0, peakOverlapRatio: 1 } });
  });

  it("upgrades ai_connected provenance when adoption crosses the threshold", () => {
    expect(reconcileSuggestionAdoption(unit("draft idea reframed", "ai_connected"), [{ id: 4, text: "reframe the draft idea" }], true).source.origin).toBe("ai_suggested");
  });

  it("sweeps created and edited cards and preserves traces through snapshot restore", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("human control"));
    expect(reconcileStoreSuggestionAdoption(store, [{ id: 3, text: "human control" }], new Set(["tu_1"]))).toHaveLength(1);
    const snapshot = store.snapshot();
    store.update("tu_1", { text: "different language" });
    reconcileStoreSuggestionAdoption(store, [{ id: 3, text: "human control" }]);
    expect(store.get("tu_1")?.source.suggestionAdoption?.currentOverlapRatio).toBe(0);
    store.loadSnapshot(snapshot);
    expect(store.get("tu_1")?.source.suggestionAdoption).toMatchObject({ adoptedFromMessageId: 3, currentOverlapRatio: 1, peakOverlapRatio: 1 });
  });

  it("never retroactively adopts a later suggestion, but does adopt after a matching edit", () => {
    const store = new ThoughtUnitStore();
    const oldCard = unit("human control");
    store.add(oldCard);
    // A suggestion arrives after this text form. Sweeping because another card
    // changed must not relabel the untouched user card.
    store.add({ ...unit("unrelated"), id: "tu_2" });
    expect(reconcileStoreSuggestionAdoption(store, [{ id: 2, text: "human control" }])).toHaveLength(0);
    expect(store.get("tu_1")?.source.origin).toBe("user_canvas");
    // The user's later text edit scopes a fresh adoption check to this card.
    expect(reconcileStoreSuggestionAdoption(store, [{ id: 2, text: "human control" }], new Set(["tu_1"]))).toMatchObject([{ cardId: "tu_1" }]);
    expect(store.get("tu_1")?.source.suggestionAdoption?.adoptedFromMessageId).toBe(2);
  });
});
