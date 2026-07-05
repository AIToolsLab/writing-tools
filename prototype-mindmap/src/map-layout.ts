import type { ThoughtConnection, XYPosition, XYSize } from "./map-store";
import type { ThoughtUnit } from "./types";

export interface AutoCleanLayoutInput {
  units: ThoughtUnit[];
  connections: ThoughtConnection[];
  positions: Record<string, XYPosition>;
  sizes: Record<string, XYSize>;
  defaultSize: XYSize;
}

const NODESEP = 64;
const ROWSEP = 88;
// Cards whose top edges are this close are treated as the same user-created row.
// This absorbs small manual misalignments and different card heights while still
// keeping clearly separate rows separate.
const ROW_TOLERANCE = 60;

interface RootLayoutNode {
  id: string;
  w: number;
  h: number;
  /** The user's existing position, used as the stable row/order prior. */
  ox: number;
  oy: number;
}

/**
 * Auto-clean layout.
 *
 * The canvas position is user-authored structure, so Auto-clean preserves rows
 * the user already made. It clusters root cards by their current vertical
 * placement, then straightens each row in place. A card keeps its horizontal
 * anchor unless it would overlap the previous card in that row, in which case it
 * is nudged just far enough right to make room. Arrows do not create new rows
 * here; they only affect connection handles after layout.
 */
export function computeAutoCleanPositions(input: AutoCleanLayoutInput): Record<string, XYPosition> {
  const { units, positions, sizes, defaultSize } = input;
  const roots = units.filter((unit) => !unit.parentId && unit.role !== "connection_label");
  if (roots.length === 0) return {};

  const nodes: RootLayoutNode[] = roots.map((unit, index) => {
    const size = sizes[unit.id] ?? defaultSize;
    const position = positions[unit.id] ?? fallbackPosition(index, defaultSize);
    return {
      id: unit.id,
      w: size.w,
      h: size.h,
      ox: position.x,
      oy: position.y,
    };
  });

  const out: Record<string, XYPosition> = {};
  const rows = clusterRows(nodes);

  for (const row of rows) {
    const ordered = [...row.nodes].sort(
      (a, b) => a.ox - b.ox || a.oy - b.oy || (a.id < b.id ? -1 : 1),
    );
    const rowY = row.anchorY;
    let previousRight = Number.NEGATIVE_INFINITY;
    for (const node of ordered) {
      const x = Math.max(node.ox, previousRight + NODESEP);
      out[node.id] = { x, y: rowY };
      previousRight = x + node.w;
    }
  }

  return out;
}

function fallbackPosition(index: number, defaultSize: XYSize): XYPosition {
  return {
    x: 80 + index * (defaultSize.w + NODESEP),
    y: 80 + Math.floor(index / 4) * (defaultSize.h + ROWSEP),
  };
}

function unorderedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function clusterRows(nodes: RootLayoutNode[]): Array<{ anchorY: number; nodes: RootLayoutNode[] }> {
  const sorted = [...nodes].sort((a, b) => a.oy - b.oy || a.ox - b.ox || (a.id < b.id ? -1 : 1));
  const rows: Array<{ anchorY: number; nodes: RootLayoutNode[] }> = [];
  for (const node of sorted) {
    const row = rows.find((candidate) => Math.abs(node.oy - candidate.anchorY) <= ROW_TOLERANCE);
    if (row) {
      row.nodes.push(node);
      row.anchorY = row.nodes.reduce((sum, item) => sum + item.oy, 0) / row.nodes.length;
    } else {
      rows.push({ anchorY: node.oy, nodes: [node] });
    }
  }
  return rows;
}

export type ConnectionHandleAssignment = {
  connectionId: string;
  sourceHandleId: string;
  targetHandleId: string;
};

const HANDLE_TOP = "top";
const HANDLE_BOTTOM = "bottom";
const HANDLE_LEFT = "left";
const HANDLE_RIGHT = "right";
const DUPLICATE_HANDLE_PAIR_CANDIDATES: Array<[string, string]> = [
  [HANDLE_RIGHT, HANDLE_LEFT],
  [HANDLE_BOTTOM, HANDLE_TOP],
  [HANDLE_LEFT, HANDLE_RIGHT],
  [HANDLE_TOP, HANDLE_BOTTOM],
  ["right-top", "left-top"],
  ["right-bottom", "left-bottom"],
  ["bottom-right", "top-right"],
  ["bottom-left", "top-left"],
];

function normalizedHandlePlacement(
  sourceId: string,
  targetId: string,
  sourceHandleId: string,
  targetHandleId: string,
): string {
  return sourceId <= targetId
    ? `${sourceHandleId}->${targetHandleId}`
    : `${targetHandleId}->${sourceHandleId}`;
}

function nonOverlappingHandlePair(
  sourceId: string,
  targetId: string,
  desiredSourceHandleId: string,
  desiredTargetHandleId: string,
  used: Set<string>,
): { sourceHandleId: string; targetHandleId: string } {
  const candidates: Array<[string, string]> = [
    [desiredSourceHandleId, desiredTargetHandleId],
    ...DUPLICATE_HANDLE_PAIR_CANDIDATES,
  ];

  for (const [sourceHandleId, targetHandleId] of candidates) {
    const placement = normalizedHandlePlacement(sourceId, targetId, sourceHandleId, targetHandleId);
    if (!used.has(placement)) {
      used.add(placement);
      return { sourceHandleId, targetHandleId };
    }
  }

  used.add(normalizedHandlePlacement(sourceId, targetId, desiredSourceHandleId, desiredTargetHandleId));
  return { sourceHandleId: desiredSourceHandleId, targetHandleId: desiredTargetHandleId };
}

/**
 * After a layout, pick legible connection handles from card geometry so lines
 * leave and enter on the facing sides instead of cutting through card interiors.
 *
 * Auto-clean preserves user-created rows. So the handle rule is row-aware:
 * cards with a real vertical gap route bottom-to-top, while cards in the same
 * row use side handles.
 *
 * Positions are top-left corners (as stored); sizes give card extents. Endpoints
 * are resolved to their rendered root/nesting owner via `rootOf` so a nested
 * endpoint routes from its card's rendered location.
 */
export function computeConnectionHandles(input: {
  connections: ThoughtConnection[];
  positions: Record<string, XYPosition>;
  sizes: Record<string, XYSize>;
  defaultSize: XYSize;
  rootOf: (id: string) => string | undefined;
}): ConnectionHandleAssignment[] {
  const { connections, positions, sizes, defaultSize, rootOf } = input;
  const size = (id: string) => sizes[id] ?? defaultSize;
  const centerOf = (id: string): { x: number; y: number } | undefined => {
    const p = positions[id];
    if (!p) return undefined;
    const s = size(id);
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 };
  };

  const assignments: ConnectionHandleAssignment[] = [];
  const usedPlacementsByPair = new Map<string, Set<string>>();
  for (const c of connections) {
    const sourceRoot = rootOf(c.sourceId) ?? c.sourceId;
    const targetRoot = rootOf(c.targetId) ?? c.targetId;
    const sc = centerOf(sourceRoot);
    const tc = centerOf(targetRoot);
    if (!sc || !tc || sourceRoot === targetRoot) continue;
    const dx = tc.x - sc.x;
    const dy = tc.y - sc.y;
    const verticalGapMin = 0.5 * Math.min(size(sourceRoot).h, size(targetRoot).h);
    let sourceHandleId: string;
    let targetHandleId: string;
    if (Math.abs(dy) >= verticalGapMin) {
      if (dy >= 0) {
        sourceHandleId = HANDLE_BOTTOM;
        targetHandleId = HANDLE_TOP;
      } else {
        sourceHandleId = HANDLE_TOP;
        targetHandleId = HANDLE_BOTTOM;
      }
    } else if (dx >= 0) {
      sourceHandleId = HANDLE_RIGHT;
      targetHandleId = HANDLE_LEFT;
    } else {
      sourceHandleId = HANDLE_LEFT;
      targetHandleId = HANDLE_RIGHT;
    }
    const pairKey = unorderedKey(sourceRoot, targetRoot);
    const usedPlacements = usedPlacementsByPair.get(pairKey) ?? new Set<string>();
    usedPlacementsByPair.set(pairKey, usedPlacements);
    const distinct = nonOverlappingHandlePair(
      sourceRoot,
      targetRoot,
      sourceHandleId,
      targetHandleId,
      usedPlacements,
    );
    assignments.push({ connectionId: c.id, ...distinct });
  }
  return assignments;
}
