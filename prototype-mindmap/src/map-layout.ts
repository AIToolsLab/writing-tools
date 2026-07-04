import dagre from "@dagrejs/dagre";
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
const RANKSEP = 88;
// Same-rank nodes share a Dagre y (or nearly so); adjacent ranks are separated
// by at least RANKSEP, so a tolerance well under RANKSEP clusters a rank without
// ever merging two.
const RANK_TOLERANCE = 40;

interface RootLayoutNode {
  id: string;
  /** Final center after layout. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The user's existing position, used as the stable horizontal-order prior. */
  ox: number;
  oy: number;
}

/**
 * Auto-clean layout.
 *
 * Dagre decides the VERTICAL hierarchy (which card ranks above which, from the
 * user's direction metadata). But Dagre's crossing-minimization also reorders
 * siblings within a rank, which scrambles the user's left-to-right arrangement.
 * So we take only Dagre's ranks and re-derive horizontal order from the user's
 * existing x-positions: within each rank, cards are laid left-to-right in the
 * order the user already had them (stable by current x, then y, then id). The
 * result tidies the tree without semantically shuffling it, and re-running on an
 * unchanged map is idempotent.
 */
export function computeAutoCleanPositions(input: AutoCleanLayoutInput): Record<string, XYPosition> {
  const { positions, defaultSize } = input;
  const model = buildRootLayoutModel(input);
  if (model.roots.length === 0) return {};
  const { roots, rootIds, directedEdges, size } = model;

  // Soft vertical inference for neutral edges: if the user placed two connected
  // cards with a clear vertical gap and no explicit direction, preserve that
  // vertical intent so a hand-built top-down tree is not flattened into a row.
  const inferred = inferVerticalEdges(model, positions, size, defaultSize);
  const rankEdges = [...directedEdges, ...inferred];

  const orderedRoots = [...roots].sort((a, b) => {
    const pa = positions[a.id] ?? { x: 0, y: 0 };
    const pb = positions[b.id] ?? { x: 0, y: 0 };
    return pa.y - pb.y || pa.x - pb.x || (a.id < b.id ? -1 : 1);
  });

  const components = connectedComponents(orderedRoots, model.adjacency);

  const out: Record<string, XYPosition> = {};
  const GAP = 120;
  const ORIGIN_X = 80;
  const ORIGIN_Y = 80;
  const MAX_ROW_WIDTH = 2400;

  let cursorX = ORIGIN_X;
  let cursorY = ORIGIN_Y;
  let rowHeight = 0;

  for (const comp of components) {
    const nodes = layoutComponent(comp, rankEdges, size, positions);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.w / 2);
      minY = Math.min(minY, n.y - n.h / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      maxY = Math.max(maxY, n.y + n.h / 2);
    }
    const compW = maxX - minX;
    const compH = maxY - minY;

    if (cursorX > ORIGIN_X && cursorX + compW > ORIGIN_X + MAX_ROW_WIDTH) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + GAP;
      rowHeight = 0;
    }

    for (const n of nodes) {
      out[n.id] = {
        x: cursorX + (n.x - n.w / 2 - minX),
        y: cursorY + (n.y - n.h / 2 - minY),
      };
    }
    cursorX += compW + GAP;
    rowHeight = Math.max(rowHeight, compH);
    void rootIds;
  }

  return out;
}

interface RootLayoutModel {
  roots: ThoughtUnit[];
  rootIds: Set<string>;
  adjacency: Map<string, Set<string>>;
  directedEdges: Array<{ from: string; to: string }>;
  rootOf: (id: string) => string | undefined;
  size: (id: string) => XYSize;
}

function buildRootLayoutModel({
  units,
  connections,
  sizes,
  defaultSize,
}: AutoCleanLayoutInput): RootLayoutModel {
  const roots = units.filter((unit) => !unit.parentId && unit.role !== "connection_label");
  const rootIds = new Set(roots.map((u) => u.id));
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const rootOf = (id: string): string | undefined => {
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
    }
    return cur?.id;
  };
  const size = (id: string) => sizes[id] ?? defaultSize;

  const adjacency = new Map<string, Set<string>>();
  roots.forEach((u) => adjacency.set(u.id, new Set()));
  const directedEdges: Array<{ from: string; to: string }> = [];
  for (const c of connections) {
    const a = rootOf(c.sourceId);
    const b = rootOf(c.targetId);
    if (!a || !b || a === b || !rootIds.has(a) || !rootIds.has(b)) continue;
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
    if (c.layoutDirection === "source_to_target") {
      directedEdges.push({ from: a, to: b });
    } else if (c.layoutDirection === "target_to_source") {
      directedEdges.push({ from: b, to: a });
    }
  }

  return { roots, rootIds, adjacency, directedEdges, rootOf, size };
}

/**
 * For neutral (undirected) connections, keep the user's vertical intent: when the
 * two connected roots sit with a clear vertical gap (dominant over horizontal),
 * add a top-to-bottom rank edge so a hand-built vertical tree is not flattened.
 * Same-row neutral connections stay neutral (no hierarchy invented).
 */
function inferVerticalEdges(
  model: RootLayoutModel,
  positions: Record<string, XYPosition>,
  size: (id: string) => XYSize,
  defaultSize: XYSize,
): Array<{ from: string; to: string }> {
  const explicit = new Set(model.directedEdges.map((e) => pairKey(e.from, e.to)));
  const inferred: Array<{ from: string; to: string }> = [];
  const seenPairs = new Set<string>();
  for (const [a, neighbors] of model.adjacency) {
    for (const b of neighbors) {
      const key = unorderedKey(a, b);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      if (explicit.has(pairKey(a, b)) || explicit.has(pairKey(b, a))) continue;
      const pa = positions[a];
      const pb = positions[b];
      if (!pa || !pb) continue;
      const dy = pb.y - pa.y;
      const dx = pb.x - pa.x;
      const threshold = 0.75 * Math.max(size(a).h, size(b).h, defaultSize.h);
      if (Math.abs(dy) <= threshold || Math.abs(dy) <= Math.abs(dx)) continue;
      if (dy > 0) inferred.push({ from: a, to: b });
      else inferred.push({ from: b, to: a });
    }
  }
  return inferred;
}

function pairKey(a: string, b: string): string {
  return `${a}->${b}`;
}

function unorderedKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function connectedComponents(
  orderedRoots: ThoughtUnit[],
  adjacency: Map<string, Set<string>>,
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const r of orderedRoots) {
    if (seen.has(r.id)) continue;
    const comp: string[] = [];
    const q = [r.id];
    seen.add(r.id);
    while (q.length > 0) {
      const id = q.shift()!;
      comp.push(id);
      for (const nb of adjacency.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          q.push(nb);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/**
 * Lay out one connected component: Dagre for ranks (vertical bands), then
 * re-derive horizontal order within each rank from the user's existing x.
 */
function layoutComponent(
  comp: string[],
  rankEdges: Array<{ from: string; to: string }>,
  size: (id: string) => XYSize,
  positions: Record<string, XYPosition>,
): RootLayoutNode[] {
  const compSet = new Set(comp);
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", acyclicer: "greedy", nodesep: NODESEP, ranksep: RANKSEP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of comp) {
    const s = size(id);
    g.setNode(id, { width: s.w, height: s.h });
  }
  for (const e of rankEdges) {
    if (compSet.has(e.from) && compSet.has(e.to)) g.setEdge(e.from, e.to, { weight: 2 });
  }

  let dagreOk = true;
  try {
    dagre.layout(g);
  } catch {
    dagreOk = false;
  }

  const nodes: RootLayoutNode[] = comp.map((id, index) => {
    const s = size(id);
    const n = dagreOk ? g.node(id) : undefined;
    const pos = positions[id];
    return {
      id,
      x: n ? n.x : index * (s.w + NODESEP) + s.w / 2,
      y: n ? n.y : s.h / 2,
      w: s.w,
      h: s.h,
      ox: pos?.x ?? (n ? n.x : index * (s.w + NODESEP)),
      oy: pos?.y ?? (n ? n.y : 0),
    };
  });

  return reorderRanksByUserX(nodes);
}

/**
 * Cluster nodes into ranks by their Dagre y, then within each rank re-place them
 * left-to-right in the user's existing horizontal order. Rank y (the vertical
 * hierarchy Dagre chose) is preserved; only intra-rank order and spacing change,
 * so siblings keep the user's left/right arrangement and never overlap.
 */
function reorderRanksByUserX(nodes: RootLayoutNode[]): RootLayoutNode[] {
  if (nodes.length <= 1) return nodes;
  const byY = [...nodes].sort((a, b) => a.y - b.y);
  const ranks: RootLayoutNode[][] = [];
  let current: RootLayoutNode[] = [];
  let rankAnchorY = Number.NEGATIVE_INFINITY;
  for (const node of byY) {
    if (current.length === 0 || node.y - rankAnchorY <= RANK_TOLERANCE) {
      if (current.length === 0) rankAnchorY = node.y;
      current.push(node);
    } else {
      ranks.push(current);
      current = [node];
      rankAnchorY = node.y;
    }
  }
  if (current.length > 0) ranks.push(current);

  for (const rank of ranks) {
    // The rank keeps its horizontal center, but its members are ordered by the
    // user's existing x (then y, then id) and spaced left-to-right by width.
    const centerX = rank.reduce((sum, n) => sum + n.x, 0) / rank.length;
    const rankY = rank.reduce((sum, n) => sum + n.y, 0) / rank.length;
    const ordered = [...rank].sort(
      (a, b) => a.ox - b.ox || a.oy - b.oy || (a.id < b.id ? -1 : 1),
    );
    const totalW = ordered.reduce((sum, n) => sum + n.w, 0) + NODESEP * (ordered.length - 1);
    let cursor = centerX - totalW / 2;
    for (const node of ordered) {
      node.x = cursor + node.w / 2;
      node.y = rankY;
      cursor += node.w + NODESEP;
    }
  }

  return nodes;
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

/**
 * After a layout, pick legible connection handles from card geometry so lines
 * leave and enter on the facing sides instead of cutting through card interiors.
 *
 * Auto-clean produces a top-down tree: cards in different ranks share no y, and
 * same-rank cards share a y exactly. So the rule is rank-aware, not a raw
 * dominant-axis vote: any two cards with a real vertical gap route bottom-to-top
 * (a card's incoming edge enters its top and its outgoing edge leaves its
 * bottom, never stacking two lines on one side just because a child is offset
 * horizontally). Horizontal handles are used only when the cards sit at
 * effectively the same height (siblings side by side).
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
  for (const c of connections) {
    const sourceRoot = rootOf(c.sourceId) ?? c.sourceId;
    const targetRoot = rootOf(c.targetId) ?? c.targetId;
    const sc = centerOf(sourceRoot);
    const tc = centerOf(targetRoot);
    if (!sc || !tc || sourceRoot === targetRoot) continue;
    const dx = tc.x - sc.x;
    const dy = tc.y - sc.y;
    // A vertical gap of at least half the shorter card's height means the cards
    // are in different ranks — route as a tree (bottom-to-top) even if the child
    // is offset sideways. Only near-equal heights use side handles.
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
    assignments.push({ connectionId: c.id, sourceHandleId, targetHandleId });
  }
  return assignments;
}
