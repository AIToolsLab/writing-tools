/**
 * Headless tests for defensive endpoint geometry. Connections normalize to root
 * cards in the store, so the old nested-endpoint proxy path must stay inactive.
 */

import { describe, expect, it } from "vitest";
import { groupDragPositions, pruneContextSelection, proxyAnchorSpecs, renderedEndpointCenter, suggestionBadge, toggleContextSelection } from "./Map";
import { ThoughtUnitStore } from "./map-store";
import type { ThoughtUnit, ThoughtUnitRole } from "./types";

function unit(id: string, parentId?: string, role: ThoughtUnitRole = "node"): ThoughtUnit {
  return {
    id,
    text: `text ${id}`,
    role,
    ...(parentId ? { parentId } : {}),
    source: { utteranceIds: [], createdBy: "user" },
    roleHistory: [{ role, changedBy: "user", at: 1 }],
  };
}

describe("proxyAnchorSpecs", () => {
  it("returns nothing when both endpoints are root cards", () => {
    const units = [unit("a"), unit("b")];
    expect(proxyAnchorSpecs(units, [{ sourceId: "a", targetId: "b" }])).toEqual([]);
  });

  it("does not preserve a nested endpoint through a proxy", () => {
    const units = [unit("root"), unit("child", "root", "content"), unit("other")];
    expect(proxyAnchorSpecs(units, [{ sourceId: "other", targetId: "child" }])).toEqual([]);
  });

  it("does not proxy multi-level nested endpoints", () => {
    const units = [
      unit("root"),
      unit("mid", "root", "subnode"),
      unit("leaf", "mid", "content"),
      unit("other"),
    ];
    expect(proxyAnchorSpecs(units, [{ sourceId: "leaf", targetId: "other" }])).toEqual([]);
  });

  it("does not emit legacy specs across multiple connections", () => {
    const units = [unit("root"), unit("child", "root", "content"), unit("a"), unit("b")];
    const specs = proxyAnchorSpecs(units, [
      { sourceId: "a", targetId: "child" },
      { sourceId: "child", targetId: "b" },
    ]);
    expect(specs).toEqual([]);
  });

  it("does not proxy either endpoint when both are nested", () => {
    const units = [
      unit("rootA"),
      unit("childA", "rootA", "content"),
      unit("rootB"),
      unit("childB", "rootB", "content"),
    ];
    const specs = proxyAnchorSpecs(units, [{ sourceId: "childA", targetId: "childB" }]);
    expect(specs).toEqual([]);
  });

  it("skips connection labels, unknown ids, and broken parent chains", () => {
    const units = [
      unit("root"),
      unit("label", "root", "connection_label"),
      unit("orphan", "missing-parent"),
    ];
    expect(
      proxyAnchorSpecs(units, [
        { sourceId: "label", targetId: "orphan" },
        { sourceId: "ghost", targetId: "root" },
      ]),
    ).toEqual([]);
  });
});

describe("suggestion badge", () => {
  it("uses a non-contradictory influence label after a full rewrite", () => {
    const adopted = {
      ...unit("rewritten"),
      source: { utteranceIds: [], createdBy: "user" as const, origin: "ai_suggested" as const, suggestionAdoption: { adoptedFromMessageId: 1, currentOverlapRatio: 0, peakOverlapRatio: 1 } },
    };
    expect(suggestionBadge(adopted)).toBe("AI-influenced");
  });
});

describe("renderedEndpointCenter", () => {
  it("ignores stale stored positions for nested cards and uses their rendered root", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("root"), { x: 100, y: 200 });
    store.add(unit("child", "root", "content"), { x: 900, y: 900 });

    expect(renderedEndpointCenter(store, "child", { w: 200, h: 100 })).toEqual({
      x: 200,
      y: 250,
    });
  });
});

describe("context selection helpers", () => {
  it("toggles shift-click context selection independently from ordinary selection", () => {
    const first = toggleContextSelection(new Set(), "a");
    expect(Array.from(first)).toEqual(["a"]);

    const second = toggleContextSelection(first, "b");
    expect(Array.from(second).sort()).toEqual(["a", "b"]);

    const third = toggleContextSelection(second, "a");
    expect(Array.from(third)).toEqual(["b"]);
  });

  it("prunes deleted, nested, or otherwise invalid ids from context selection", () => {
    const current = new Set(["root-a", "root-b", "child"]);
    const validRoots = new Set(["root-b"]);

    expect(Array.from(pruneContextSelection(current, validRoots))).toEqual(["root-b"]);
  });

  it("moves every selected card by the primary card drag delta", () => {
    const selected = new Set(["a", "b", "c"]);
    const starts = new Map([
      ["a", { x: 10, y: 20 }],
      ["b", { x: 100, y: 120 }],
      ["c", { x: -40, y: 0 }],
    ]);

    const next = groupDragPositions(selected, starts, "a", { x: 25, y: 15 });

    expect(next.get("a")).toEqual({ x: 25, y: 15 });
    expect(next.get("b")).toEqual({ x: 115, y: 115 });
    expect(next.get("c")).toEqual({ x: -25, y: -5 });
  });
});
