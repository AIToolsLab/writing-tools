/**
 * Headless tests for the nested-connection proxy anchors. The rendering side is
 * verified visually; these pin the spec derivation: which endpoints need a
 * proxy, and which root canvas node each proxy must be parented to.
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

  it("maps a nested endpoint to its root ancestor", () => {
    const units = [unit("root"), unit("child", "root", "content"), unit("other")];
    expect(proxyAnchorSpecs(units, [{ sourceId: "other", targetId: "child" }])).toEqual([
      { id: "child", rootId: "root" },
    ]);
  });

  it("walks multi-level nesting to the actual canvas node", () => {
    const units = [
      unit("root"),
      unit("mid", "root", "subnode"),
      unit("leaf", "mid", "content"),
      unit("other"),
    ];
    expect(proxyAnchorSpecs(units, [{ sourceId: "leaf", targetId: "other" }])).toEqual([
      { id: "leaf", rootId: "root" },
    ]);
  });

  it("emits one spec per endpoint even across multiple connections", () => {
    const units = [unit("root"), unit("child", "root", "content"), unit("a"), unit("b")];
    const specs = proxyAnchorSpecs(units, [
      { sourceId: "a", targetId: "child" },
      { sourceId: "child", targetId: "b" },
    ]);
    expect(specs).toEqual([{ id: "child", rootId: "root" }]);
  });

  it("covers both endpoints when each is nested in a different parent", () => {
    const units = [
      unit("rootA"),
      unit("childA", "rootA", "content"),
      unit("rootB"),
      unit("childB", "rootB", "content"),
    ];
    const specs = proxyAnchorSpecs(units, [{ sourceId: "childA", targetId: "childB" }]);
    expect(specs).toEqual([
      { id: "childA", rootId: "rootA" },
      { id: "childB", rootId: "rootB" },
    ]);
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
