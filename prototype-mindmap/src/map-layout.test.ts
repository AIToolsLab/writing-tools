import { describe, expect, it } from "vitest";
import { computeAutoCleanPositions, computeConnectionHandles } from "./map-layout";
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
  it("keeps current rows even when a source-to-target arrow points the other way", () => {
    const positions = layout(
      [unit("a"), unit("b")],
      [connection("ab", "a", "b", "source_to_target")],
      { a: { x: 400, y: 300 }, b: { x: 80, y: 80 } },
    );

    expect(positions.b.y).toBeLessThan(positions.a.y);
  });

  it("keeps current rows even when a target-to-source arrow points the other way", () => {
    const positions = layout(
      [unit("a"), unit("b")],
      [connection("ab", "a", "b", "target_to_source")],
      { a: { x: 80, y: 80 }, b: { x: 400, y: 300 } },
    );

    expect(positions.a.y).toBeLessThan(positions.b.y);
  });

  it("does not let duplicate connection direction change a user-created row", () => {
    const positions = layout(
      [unit("a"), unit("b")],
      [
        connection("ab-neutral", "a", "b"),
        connection("ab-directed", "a", "b", "source_to_target"),
      ],
      { a: { x: 80, y: 200 }, b: { x: 420, y: 200 } },
    );

    expect(positions.a.y).toBe(positions.b.y);
  });

  it("keeps neutral connections on their current row without creating hierarchy", () => {
    const positions = layout(
      [unit("a"), unit("b")],
      [connection("ab", "a", "b")],
      { a: { x: 400, y: 80 }, b: { x: 80, y: 80 } },
    );

    expect(boxesOverlap(positions.a, positions.b)).toBe(false);
    expect(Math.abs(positions.b.y - positions.a.y)).toBeLessThanOrEqual(defaultSize.h);
    expect(positions.b.x).toBe(80);
    expect(positions.a.x).toBe(400);
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
      { parent: { x: 80, y: 80 }, child: { x: 900, y: 900 }, other: { x: 80, y: 300 } },
    );

    expect(positions.parent).toBeDefined();
    expect(positions.other).toBeDefined();
    expect(positions.child).toBeUndefined();
    expect(positions.parent.y).toBeLessThan(positions.other.y);
  });

  it("preserves the user's left-to-right sibling order under a directed source", () => {
    // Source with three children; the user placed them in the order c3, c1, c2
    // left-to-right. Auto-clean must keep that horizontal order, not reshuffle.
    const positions = layout(
      [unit("s"), unit("c1"), unit("c2"), unit("c3")],
      [
        connection("s1", "s", "c1", "source_to_target"),
        connection("s2", "s", "c2", "source_to_target"),
        connection("s3", "s", "c3", "source_to_target"),
      ],
      {
        s: { x: 200, y: 0 },
        c3: { x: 0, y: 300 },
        c1: { x: 300, y: 300 },
        c2: { x: 600, y: 300 },
      },
    );

    // Source ranks above the children.
    expect(positions.s.y).toBeLessThan(positions.c1.y);
    // Children keep the user's left-to-right order: c3 < c1 < c2.
    expect(positions.c3.x).toBeLessThan(positions.c1.x);
    expect(positions.c1.x).toBeLessThan(positions.c2.x);
  });

  it("is idempotent: re-running on its own output does not move cards", () => {
    const units = [unit("s"), unit("c1"), unit("c2"), unit("c3")];
    const connections = [
      connection("s1", "s", "c1", "source_to_target"),
      connection("s2", "s", "c2", "source_to_target"),
      connection("s3", "s", "c3", "source_to_target"),
    ];
    const first = layout(units, connections, {
      s: { x: 200, y: 0 },
      c3: { x: 0, y: 300 },
      c1: { x: 300, y: 300 },
      c2: { x: 600, y: 300 },
    });
    const second = layout(units, connections, first);
    for (const id of Object.keys(first)) {
      expect(second[id].x).toBeCloseTo(first[id].x, 5);
      expect(second[id].y).toBeCloseTo(first[id].y, 5);
    }
  });

  it("keeps a directed edge lateral when the user placed the target level, not below", () => {
    // #19 above #12 (a real vertical parent→child). #12→#57 is also directed, but
    // the user put #57 level with #12 and to its right — that must stay a
    // side-by-side (same-rank) relationship, not get forced into a rank below #12.
    const positions = layout(
      [unit("n19"), unit("n12"), unit("n57")],
      [
        connection("e1", "n19", "n12", "source_to_target"),
        connection("e2", "n12", "n57", "source_to_target"),
      ],
      {
        n19: { x: 200, y: 0 },
        n12: { x: 200, y: 300 },
        n57: { x: 600, y: 300 },
      },
    );

    // #19 stays above #12 (that gap was real).
    expect(positions.n19.y).toBeLessThan(positions.n12.y);
    // #57 stays on #12's rank (same y) and to its right — not stacked below.
    expect(positions.n57.y).toBeCloseTo(positions.n12.y, 5);
    expect(positions.n57.x).toBeGreaterThan(positions.n12.x);
  });

  it("keeps a lateral card with its own child on the anchored rank", () => {
    const positions = layout(
      [unit("n19"), unit("n12"), unit("n57"), unit("n99")],
      [
        connection("e1", "n19", "n12", "source_to_target"),
        connection("e2", "n12", "n57", "source_to_target"),
        connection("e3", "n57", "n99", "source_to_target"),
      ],
      {
        n19: { x: 200, y: 0 },
        n12: { x: 200, y: 300 },
        n57: { x: 600, y: 300 },
        n99: { x: 600, y: 600 },
      },
    );

    expect(positions.n19.y).toBeLessThan(positions.n12.y);
    expect(positions.n57.y).toBeCloseTo(positions.n12.y, 5);
    expect(positions.n99.y).toBeGreaterThan(positions.n57.y);
  });

  it("preserves rows from the real borderline map dump", () => {
    const units = [
      "tu_10",
      "tu_12",
      "tu_19",
      "tu_26",
      "tu_39",
      "tu_44",
      "tu_45",
      "tu_49",
      "tu_50",
      "tu_57",
      "tu_61",
      "tu_68",
      "tu_77",
      "tu_80",
    ].map((id) => unit(id));
    const positions = layout(
      units,
      [
        connection("e10-19", "tu_10", "tu_19", "target_to_source"),
        connection("e12-19", "tu_12", "tu_19", "target_to_source"),
        connection("e44-19", "tu_44", "tu_19", "target_to_source"),
        connection("e44-49", "tu_44", "tu_49", "source_to_target"),
        connection("e12-57", "tu_12", "tu_57", "source_to_target"),
        connection("e77-68", "tu_77", "tu_68"),
      ],
      {
        tu_10: { x: 784, y: 308 },
        tu_12: { x: 1432, y: 308 },
        tu_19: { x: 1108, y: 80 },
        tu_26: { x: 213.4613239253788, y: 15.686859273066176 },
        tu_39: { x: 493.461323925379, y: 15.686859273066176 },
        tu_44: { x: 1108, y: 308 },
        tu_45: { x: 469, y: 124 },
        tu_49: { x: 840, y: 536 },
        tu_50: { x: 101.035595493631, y: 464.7784217386403 },
        tu_57: { x: 1108, y: 536 },
        tu_61: { x: 843.7219517030741, y: 242.94043029062763 },
        tu_68: { x: 404, y: 80 },
        tu_77: { x: 80, y: 80 },
        tu_80: { x: 360, y: 620 },
      },
    );

    expect(positions.tu_10.y).toBe(positions.tu_44.y);
    expect(positions.tu_44.y).toBe(positions.tu_12.y);
    expect(positions.tu_19.x).toBeCloseTo(positions.tu_44.x, 5);
    expect(positions.tu_10.x).toBeLessThan(positions.tu_44.x);
    expect(positions.tu_44.x).toBeLessThan(positions.tu_12.x);
    expect(positions.tu_57.y).toBeGreaterThan(positions.tu_12.y);
  });

  it("preserves a hand-built vertical tree even when the connection is neutral", () => {
    // No direction metadata, but the user stacked parent above child with a big
    // vertical gap. Auto-clean should keep the parent above, not flatten to a row.
    const positions = layout(
      [unit("top"), unit("bottom")],
      [connection("tb", "top", "bottom")],
      { top: { x: 100, y: 40 }, bottom: { x: 100, y: 400 } },
    );

    expect(positions.top.y).toBeLessThan(positions.bottom.y);
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

describe("computeConnectionHandles", () => {
  const identityRoot = (id: string) => id;

  function normalizedPlacement(
    sourceId: string,
    targetId: string,
    sourceHandleId: string,
    targetHandleId: string,
  ): string {
    return sourceId <= targetId
      ? `${sourceHandleId}->${targetHandleId}`
      : `${targetHandleId}->${sourceHandleId}`;
  }

  it("routes a card above its neighbor bottom-to-top", () => {
    const handles = computeConnectionHandles({
      connections: [connection("ab", "a", "b", "source_to_target")],
      positions: { a: { x: 100, y: 0 }, b: { x: 100, y: 400 } },
      sizes: {},
      defaultSize,
      rootOf: identityRoot,
    });
    expect(handles).toEqual([{ connectionId: "ab", sourceHandleId: "bottom", targetHandleId: "top" }]);
  });

  it("routes a left card to its right neighbor right-to-left", () => {
    const handles = computeConnectionHandles({
      connections: [connection("ab", "a", "b")],
      positions: { a: { x: 0, y: 100 }, b: { x: 600, y: 100 } },
      sizes: {},
      defaultSize,
      rootOf: identityRoot,
    });
    expect(handles).toEqual([{ connectionId: "ab", sourceHandleId: "right", targetHandleId: "left" }]);
  });

  it("keeps duplicate connections between the same rendered cards on separate handle placements", () => {
    const handles = computeConnectionHandles({
      connections: [
        connection("ab", "a", "b"),
        connection("ba", "b", "a"),
      ],
      positions: { a: { x: 0, y: 100 }, b: { x: 600, y: 100 } },
      sizes: {},
      defaultSize,
      rootOf: identityRoot,
    });

    expect(handles).toEqual([
      { connectionId: "ab", sourceHandleId: "right", targetHandleId: "left" },
      { connectionId: "ba", sourceHandleId: "right", targetHandleId: "left" },
    ]);
    expect(
      new Set(
        handles.map((handle) =>
          normalizedPlacement(
            handle.connectionId === "ab" ? "a" : "b",
            handle.connectionId === "ab" ? "b" : "a",
            handle.sourceHandleId,
            handle.targetHandleId,
          ),
        ),
      ).size,
    ).toBe(2);
  });

  it("routes a card to a lower-but-offset child vertically, not out the side", () => {
    // Child is one rank below but shifted left (larger horizontal than vertical
    // delta). In a top-down tree it must still exit the bottom / enter the top,
    // so the parent's incoming and outgoing edges don't stack on one side.
    const handles = computeConnectionHandles({
      connections: [connection("ab", "a", "b", "source_to_target")],
      positions: { a: { x: 600, y: 0 }, b: { x: 0, y: 300 } },
      sizes: {},
      defaultSize,
      rootOf: identityRoot,
    });
    expect(handles).toEqual([{ connectionId: "ab", sourceHandleId: "bottom", targetHandleId: "top" }]);
  });

  it("resolves a nested endpoint to its rendering root for geometry", () => {
    const handles = computeConnectionHandles({
      connections: [connection("ab", "child", "b")],
      positions: { root: { x: 100, y: 0 }, b: { x: 100, y: 400 } },
      sizes: {},
      defaultSize,
      rootOf: (id) => (id === "child" ? "root" : id),
    });
    expect(handles).toEqual([{ connectionId: "ab", sourceHandleId: "bottom", targetHandleId: "top" }]);
  });

  it("skips a connection when an endpoint has no known position", () => {
    const handles = computeConnectionHandles({
      connections: [connection("ab", "a", "b")],
      positions: { a: { x: 0, y: 0 } },
      sizes: {},
      defaultSize,
      rootOf: identityRoot,
    });
    expect(handles).toEqual([]);
  });
});
