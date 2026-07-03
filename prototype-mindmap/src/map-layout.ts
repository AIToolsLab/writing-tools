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

export function computeAutoCleanPositions({
  units,
  connections,
  positions,
  sizes,
  defaultSize,
}: AutoCleanLayoutInput): Record<string, XYPosition> {
  const roots = units.filter((unit) => !unit.parentId && unit.role !== "connection_label");
  if (roots.length === 0) return {};

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

  const orderedRoots = [...roots].sort((x, y) => {
    const px = positions[x.id] ?? { x: 0, y: 0 };
    const py = positions[y.id] ?? { x: 0, y: 0 };
    return px.y - py.y || px.x - py.x;
  });

  const adj = new Map<string, Set<string>>();
  roots.forEach((u) => adj.set(u.id, new Set()));
  const directedEdges: Array<{ from: string; to: string }> = [];
  for (const c of connections) {
    const a = rootOf(c.sourceId);
    const b = rootOf(c.targetId);
    if (!a || !b || a === b || !rootIds.has(a) || !rootIds.has(b)) continue;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
    if (c.layoutDirection === "source_to_target") {
      directedEdges.push({ from: a, to: b });
    } else if (c.layoutDirection === "target_to_source") {
      directedEdges.push({ from: b, to: a });
    }
  }

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
      for (const nb of adj.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          q.push(nb);
        }
      }
    }
    components.push(comp);
  }

  const out: Record<string, XYPosition> = {};
  const GAP = 120;
  const ORIGIN_X = 80;
  const ORIGIN_Y = 80;
  const MAX_ROW_WIDTH = 2400;

  let cursorX = ORIGIN_X;
  let cursorY = ORIGIN_Y;
  let rowHeight = 0;
  for (const comp of components) {
    const compSet = new Set(comp);
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", acyclicer: "greedy", nodesep: 64, ranksep: 88, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const id of comp) {
      const s = size(id);
      g.setNode(id, { width: s.w, height: s.h });
    }
    for (const e of directedEdges) {
      if (compSet.has(e.from) && compSet.has(e.to)) g.setEdge(e.from, e.to, { weight: 2 });
    }
    try {
      dagre.layout(g);
    } catch {
      comp.forEach((id, index) => {
        const s = size(id);
        g.setNode(id, { x: index * (s.w + 80) + s.w / 2, y: s.h / 2 });
      });
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of comp) {
      const n = g.node(id);
      const s = size(id);
      minX = Math.min(minX, n.x - s.w / 2);
      minY = Math.min(minY, n.y - s.h / 2);
      maxX = Math.max(maxX, n.x + s.w / 2);
      maxY = Math.max(maxY, n.y + s.h / 2);
    }
    const compW = maxX - minX;
    const compH = maxY - minY;

    if (cursorX > ORIGIN_X && cursorX + compW > ORIGIN_X + MAX_ROW_WIDTH) {
      cursorX = ORIGIN_X;
      cursorY += rowHeight + GAP;
      rowHeight = 0;
    }

    for (const id of comp) {
      const n = g.node(id);
      const s = size(id);
      out[id] = {
        x: cursorX + (n.x - s.w / 2 - minX),
        y: cursorY + (n.y - s.h / 2 - minY),
      };
    }
    cursorX += compW + GAP;
    rowHeight = Math.max(rowHeight, compH);
  }

  return out;
}
