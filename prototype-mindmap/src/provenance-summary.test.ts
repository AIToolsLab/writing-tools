import { describe, expect, it } from "vitest";
import { provenanceTotals } from "./provenance-summary";
import type { ThoughtUnit } from "./types";
import type { ThoughtConnection } from "./map-store";

const unit = (id: string, origin: ThoughtUnit["source"]["origin"], parentId?: string, parentOrigin?: ThoughtUnit["parentProvenance"]): ThoughtUnit => ({
  id, text: id, role: parentId ? "content" : "node", parentId, parentProvenance: parentOrigin,
  source: { utteranceIds: [], createdBy: "user", origin }, roleHistory: [],
});

describe("provenance totals", () => {
  it("counts cards, nesting, and connections once while omitting label units", () => {
    const units = [
      unit("a", "user_canvas"),
      unit("b", "ai_connected", "a", { origin: "ai_suggested" }),
      { ...unit("label", "ai_suggested"), role: "connection_label" as const },
    ];
    const connections = [{ id: "e", sourceId: "a", targetId: "b", labelUnitId: "label", confirmedAt: 1, createdBy: "user" as const, layoutDirection: "none" as const, origin: "legacy_confirmed" as const } satisfies ThoughtConnection];
    expect(provenanceTotals(units, connections)).toEqual({ userAuthored: 2, drawnFromDraft: 1, aiSuggested: 1, total: 4 });
  });
});
