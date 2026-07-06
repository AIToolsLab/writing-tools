/**
 * Headless tests for defensive endpoint geometry. Connections normalize to root
 * cards in the store, so the old nested-endpoint proxy path must stay inactive.
 */

import { describe, expect, it } from "vitest";
import { proxyAnchorSpecs, renderedEndpointCenter } from "./Map";
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
