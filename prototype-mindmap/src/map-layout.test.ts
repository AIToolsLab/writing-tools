import { describe, expect, it } from "vitest";
import { computeAutoCleanPositions } from "./map-layout";
import type { ThoughtConnection, XYPosition, XYSize } from "./map-store";
import type { ThoughtUnit } from "./types";

const defaultSize: XYSize = { w: 200, h: 100 };

function unit(id: string, text = id, parentId?: string): ThoughtUnit {
  return {
    id,
    text,
    role: "node",
    parentId,
    source: { utteranceIds: [], createdBy: "user" },
    roleHistory: [{ role: "node", changedBy: "user", at: 0 }],
  };
}

function connection(
  id: string,
  sourceId: string,
  targetId: string,
  layoutDirection: ThoughtConnection["layoutDirection"] = "none",
): ThoughtConnection {
  return {
    id,
    sourceId,
    targetId,
    layoutDirection,
    labelUnitId: `${id}-label`,
    confirmedAt: 0,
    createdBy: "user",
  };
}

function layout(
  units: ThoughtUnit[],
  connections: ThoughtConnection[],
  positions: Record<string, XYPosition> = {},
  sizes: Record<string, XYSize> = {},
) {
  return computeAutoCleanPositions({
    units,
    connections,
    positions,
    sizes,
    defaultSize,
  });
}

function boxesOverlap(a: XYPosition, b: XYPosition) {
  return !(
    a.x + defaultSize.w <= b.x ||
    b.x + defaultSize.w <= a.x ||
    a.y + defaultSize.h <= b.y ||
    b.y + defaultSize.h <= a.y
  );
}

function boxesOverlapWithSizes(
  a: XYPosition,
  aSize: XYSize,
  b: XYPosition,
  bSize: XYSize,
) {
  return !(
    a.x + aSize.w <= b.x ||
    b.x + bSize.w <= a.x ||
    a.y + aSize.h <= b.y ||
    b.y + bSize.h <= a.y
  );
}

describe("computeAutoCleanPositions", () => {
  it("places source cards above targets for source-to-target directions", () => {
    const positions = layout([unit("a"), unit("b")], [connection("ab", "a", "b", "source_to_target")]);

    expect(positions.a.y).toBeLessThan(positions.b.y);
  });

  it("places target cards above sources for target-to-source directions", () => {
    const positions = layout([unit("a"), unit("b")], [connection("ab", "a", "b", "target_to_source")]);

    expect(positions.b.y).toBeLessThan(positions.a.y);
  });

  it("keeps neutral connections compact without creating hierarchy", () => {
    const positions = layout(
      [unit("a"), unit("b")],
      [connection("ab", "a", "b")],
      { a: { x: 400, y: 80 }, b: { x: 80, y: 80 } },
    );

    expect(boxesOverlap(positions.a, positions.b)).toBe(false);
    expect(Math.abs(positions.b.y - positions.a.y)).toBeLessThanOrEqual(defaultSize.h);
    expect(Math.abs(positions.b.x - positions.a.x)).toBeLessThanOrEqual(defaultSize.w + 80);
  });

  it("packs disconnected components without overlap", () => {
    const positions = layout(
      [unit("a"), unit("b"), unit("c"), unit("d")],
      [connection("ab", "a", "b", "source_to_target"), connection("cd", "c", "d", "source_to_target")],
    );

    for (const left of ["a", "b"]) {
      for (const right of ["c", "d"]) {
        expect(boxesOverlap(positions[left], positions[right])).toBe(false);
      }
    }
  });

  it("returns stable positions for directed cycles instead of crashing", () => {
    const positions = layout(
      [unit("a"), unit("b"), unit("c")],
      [
        connection("ab", "a", "b", "source_to_target"),
        connection("bc", "b", "c", "source_to_target"),
        connection("ca", "c", "a", "source_to_target"),
      ],
    );

    expect(Object.keys(positions).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not position nested children independently", () => {
    const positions = layout(
      [unit("parent"), unit("child", "child", "parent"), unit("other")],
      [connection("co", "child", "other", "source_to_target")],
    );

    expect(positions.parent).toBeDefined();
    expect(positions.other).toBeDefined();
    expect(positions.child).toBeUndefined();
    expect(positions.parent.y).toBeLessThan(positions.other.y);
  });

  it("uses supplied rendered root sizes so expanded nested parents do not overlap components", () => {
    const tallParent = { w: 200, h: 360 };
    const positions = layout(
      [
        unit("parent"),
        unit("child", "child", "parent"),
        unit("other"),
        unit("separate"),
      ],
      [connection("co", "child", "other", "source_to_target")],
      {},
      { parent: tallParent },
    );

    expect(positions.parent).toBeDefined();
    expect(positions.other).toBeDefined();
    expect(positions.separate).toBeDefined();
    expect(boxesOverlapWithSizes(positions.parent, tallParent, positions.separate, defaultSize)).toBe(false);
    expect(boxesOverlapWithSizes(positions.parent, tallParent, positions.other, defaultSize)).toBe(false);
  });
});
