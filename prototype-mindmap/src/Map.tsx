import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MiniMap,
  ConnectionMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnReconnect,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { ThoughtUnitStore, XYPosition, XYSize } from "./map-store";
import type { SourceBank } from "./store";
import { cardRef } from "./store";
import type { ConfirmedReflection, ThoughtUnit } from "./types";

const CARD_WIDTH = 260;
const CARD_HEIGHT = 140;
const CARD_MIN_WIDTH = 180;
const CARD_MIN_HEIGHT = 110;
const EMBEDDED_CARD_DRAG_TYPE = "application/x-prototype-mindmap-card";

const CONNECTION_ANCHORS: Array<{
  id: string;
  position: Position;
  className: string;
  style?: React.CSSProperties;
}> = [
  { id: "top-left", position: Position.Top, className: "map-handle-top map-handle-corner", style: { left: 24 } },
  { id: "top", position: Position.Top, className: "map-handle-top" },
  { id: "top-right", position: Position.Top, className: "map-handle-top map-handle-corner", style: { left: "calc(100% - 24px)" } },
  { id: "right-top", position: Position.Right, className: "map-handle-right map-handle-corner", style: { top: 24 } },
  { id: "right", position: Position.Right, className: "map-handle-right" },
  { id: "right-bottom", position: Position.Right, className: "map-handle-right map-handle-corner", style: { top: "calc(100% - 24px)" } },
  { id: "bottom-right", position: Position.Bottom, className: "map-handle-bottom map-handle-corner", style: { left: "calc(100% - 24px)" } },
  { id: "bottom", position: Position.Bottom, className: "map-handle-bottom" },
  { id: "bottom-left", position: Position.Bottom, className: "map-handle-bottom map-handle-corner", style: { left: 24 } },
  { id: "left-bottom", position: Position.Left, className: "map-handle-left map-handle-corner", style: { top: "calc(100% - 24px)" } },
  { id: "left", position: Position.Left, className: "map-handle-left" },
  { id: "left-top", position: Position.Left, className: "map-handle-left map-handle-corner", style: { top: 24 } },
];

interface PendingConnection {
  sourceId: string;
  targetId: string;
  sourceHandleId?: string | null;
  targetHandleId?: string | null;
  text: string;
}

/** Id-based actions shared by a card and every card embedded inside it. */
interface CardActions {
  onCommitText: (id: string, text: string) => void;
  onPullOut: (id: string) => void;
  onPromote: (id: string) => void;
  onDelete: (id: string) => void;
  onResizeStart: (
    id: string,
    edges: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean },
    event: React.MouseEvent,
  ) => void;
  getChildren: (id: string) => ThoughtUnit[];
}

type ThoughtNodeData = {
  unit: ThoughtUnit;
  actions: CardActions;
  sourceLabel: string;
  size: XYSize;
} & Record<string, unknown>;

type ThoughtFlowNode = Node<ThoughtNodeData, "thought">;

interface ThoughtMapProps {
  store: ThoughtUnitStore;
  bank: SourceBank;
  confirmed: ConfirmedReflection[];
  coachDebug?: CoachDebugInfo | null;
  commandAck?: MapCommandAcknowledgement | null;
  revision: number;
  questionBias: number;
  onQuestionBiasChange: (value: number) => void;
  requireConnectionLabel: boolean;
  onRequireConnectionLabelChange: (value: boolean) => void;
  canUndo: boolean;
  onUndo: () => void;
  onBeforeMapChange: () => void;
  onStoreChange: () => void;
}

export interface MapCommandAcknowledgement {
  text: string;
}

export interface CoachDebugInfo {
  mode: string;
  suppressionReason?: string;
  suppressionDetail?: string;
  validationDebug?: Array<{
    claimId: string;
    claimText: string;
    target: string;
    message: string;
    checks: Array<{
      check: string;
      ok: boolean;
      score: number;
      threshold: number;
      parts?: Array<{
        name: string;
        ok: boolean;
        score: number;
        threshold: number;
      }>;
    }>;
    sourceSpans: Array<{
      claimText: string;
      userPhrase: string;
      utteranceIds: string[];
      citedUtterances: Array<{ id: string; text: string }>;
    }>;
  }>;
  acceleratedCandidateIds?: string[];
  readinessNotes?: string[];
  commandDebug?: Array<{
    reason: string;
    detail: string;
  }>;
}

function scoreText(score: number, threshold: number): string {
  return `${score.toFixed(2)} / ${threshold.toFixed(2)}`;
}

function bounds(node: Node): { x: number; y: number; width: number; height: number } {
  const width = node.measured?.width ?? node.width ?? CARD_WIDTH;
  const height = node.measured?.height ?? node.height ?? CARD_HEIGHT;
  return { x: node.position.x, y: node.position.y, width, height };
}

function findDropTarget(moved: Node, nodes: Node[]): Node | undefined {
  const movedBounds = bounds(moved);
  const center = {
    x: movedBounds.x + movedBounds.width / 2,
    y: movedBounds.y + movedBounds.height / 2,
  };
  return nodes.find((node) => {
    if (node.id === moved.id) return false;
    const box = bounds(node);
    return (
      center.x >= box.x &&
      center.x <= box.x + box.width &&
      center.y >= box.y &&
      center.y <= box.y + box.height
    );
  });
}

function sourceLabel(unit: ThoughtUnit): string {
  const utterances = unit.source.utteranceIds.length
    ? unit.source.utteranceIds.join(", ")
    : "none";
  if (unit.source.reflectionId) {
    return `reflection ${unit.source.reflectionId}; source utterances: ${utterances}`;
  }
  return `user-authored; source utterances: ${utterances}`;
}

function connectionMidpoint(store: ThoughtUnitStore, sourceId: string, targetId: string): XYPosition {
  const source = store.getPosition(sourceId) ?? { x: 120, y: 120 };
  const target = store.getPosition(targetId) ?? { x: source.x + 220, y: source.y };
  return {
    x: (source.x + target.x) / 2 + 28,
    y: (source.y + target.y) / 2 + 44,
  };
}

function roleLabel(unit: ThoughtUnit, childCount: number): string {
  // The reference number replaces the generic "card" word so the user and the
  // AI can cite the same handle. Title cards keep the word plus the ref.
  if (unit.role === "connection_label") return "connection";
  const ref = cardRef(unit.id);
  if (childCount > 0) return `title · ${ref}`;
  if (unit.role === "subnode") return `subnode · ${ref}`;
  return ref;
}

function anchorHandleId(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return id.replace(/^(source|target)-/, "");
}

function renderHandleId(type: "source" | "target", id: string | undefined): string | undefined {
  const anchorId = anchorHandleId(id);
  return anchorId ? `${type}-${anchorId}` : undefined;
}

function ConnectionHandles() {
  return (
    <>
      {CONNECTION_ANCHORS.map((anchor) => (
        <Handle
          key={`source-${anchor.id}`}
          type="source"
          id={`source-${anchor.id}`}
          position={anchor.position}
          className={`map-handle map-handle-source ${anchor.className}`}
          style={anchor.style}
        />
      ))}
      {CONNECTION_ANCHORS.map((anchor) => (
        <Handle
          key={`target-${anchor.id}`}
          type="target"
          id={`target-${anchor.id}`}
          position={anchor.position}
          className={`map-handle map-handle-target ${anchor.className}`}
          style={anchor.style}
        />
      ))}
    </>
  );
}

/**
 * A card embedded inside its parent's body. Recursive: an embedded card can hold
 * its own nested cards. This is what gives nesting a real "inside the parent"
 * visual instead of a card sitting on top of another.
 */
function EmbeddedCard({ unit, actions }: { unit: ThoughtUnit; actions: CardActions }) {
  const [draft, setDraft] = useState(unit.text);
  const [dragging, setDragging] = useState(false);
  useEffect(() => setDraft(unit.text), [unit.id, unit.text]);
  const children = actions.getChildren(unit.id);

  return (
    <div
      className={`map-embed role-${unit.role} ${dragging ? "dragging" : ""}`}
      draggable
      title="Drag to the canvas to pull this card out"
      onDragStart={(event) => {
        event.stopPropagation();
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(EMBEDDED_CARD_DRAG_TYPE, unit.id);
        event.dataTransfer.setData("text/plain", unit.text);
        setDragging(true);
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        setDragging(false);
      }}
    >
      <textarea
        className="map-embed-editor nodrag nowheel"
        value={draft}
        rows={2}
        placeholder="(empty)"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== unit.text) actions.onCommitText(unit.id, draft);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      />
      <div className="map-embed-actions nodrag">
        <span className="map-embed-ref" title="Card reference">{cardRef(unit.id)}</span>
        <button type="button" onClick={() => actions.onPromote(unit.id)} title="Make this the title">
          Title
        </button>
        <button type="button" onClick={() => actions.onPullOut(unit.id)} title="Pull out to its own card">
          Out
        </button>
        <button type="button" onClick={() => actions.onDelete(unit.id)} title="Delete">
          ✕
        </button>
      </div>
      {children.length > 0 && (
        <div className="map-embed-children">
          {children.map((child) => (
            <EmbeddedCard key={child.id} unit={child} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThoughtCardNode({ data, selected }: NodeProps<ThoughtFlowNode>) {
  const { unit, actions, size } = data;
  const [draft, setDraft] = useState(unit.text);

  useEffect(() => {
    setDraft(unit.text);
  }, [unit.id, unit.text]);

  const children = actions.getChildren(unit.id);

  const commit = useCallback(() => {
    if (draft !== unit.text) actions.onCommitText(unit.id, draft);
  }, [actions, draft, unit.id, unit.text]);

  // Auto-expand: a card with nested children grows to fit them (stored height
  // becomes a min-height) so a newly nested child is never clipped and the user
  // doesn't hand-resize. Childless cards keep their exact stored size.
  const hasChildren = children.length > 0;

  return (
    <div
      className={`map-card ${selected ? "selected" : ""} role-${unit.role} ${
        hasChildren ? "has-children" : ""
      }`}
      style={
        hasChildren
          ? { width: size.w, minHeight: size.h, height: "auto" }
          : { width: size.w, height: size.h }
      }
      title={data.sourceLabel}
    >
      <ConnectionHandles />
      <div
        className="map-resize-edge map-resize-n nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { top: true }, event)}
      />
      <div
        className="map-resize-edge map-resize-e nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { right: true }, event)}
      />
      <div
        className="map-resize-edge map-resize-s nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { bottom: true }, event)}
      />
      <div
        className="map-resize-edge map-resize-w nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { left: true }, event)}
      />
      <div
        className="map-resize-corner map-resize-nw nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { top: true, left: true }, event)}
      />
      <div
        className="map-resize-corner map-resize-ne nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { top: true, right: true }, event)}
      />
      <div
        className="map-resize-corner map-resize-se nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { bottom: true, right: true }, event)}
      />
      <div
        className="map-resize-corner map-resize-sw nodrag"
        onMouseDown={(event) => actions.onResizeStart(unit.id, { bottom: true, left: true }, event)}
      />

      <button
        type="button"
        className="map-card-close nodrag"
        onClick={() => actions.onDelete(unit.id)}
        title="Delete card"
      >
        ✕
      </button>

      <div className="map-card-drag">
        <span className="map-role-chip">{roleLabel(unit, children.length)}</span>
      </div>

      <textarea
        className="map-card-editor nodrag nowheel"
        value={draft}
        placeholder="(empty card — type your idea)"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      />

      <div className="map-card-actions nodrag">
        <span className="map-source-dot" aria-label={data.sourceLabel} />
      </div>

      {children.length > 0 && (
        <div className="map-card-children nodrag">
          {children.map((child) => (
            <EmbeddedCard key={child.id} unit={child} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { thought: ThoughtCardNode };

/**
 * Connection edge with a small badge at the midpoint. The relationship wording
 * is hidden by default (declutters the canvas) and expands on click.
 */
function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const [open, setOpen] = useState(false);
  const label = typeof data?.label === "string" ? data.label : "";
  const onDelete = typeof data?.onDelete === "function" ? (data.onDelete as (id: string) => void) : undefined;

  return (
    <>
      <BaseEdge id={id} path={edgePath} className="map-edge" />
      <EdgeLabelRenderer>
        <div
          className="edge-badge-wrap nodrag nopan"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          <button
            type="button"
            className="edge-badge"
            title={label || "connection"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "×" : "↔"}
          </button>
          {open && (
            <div className="edge-popover">
              {label && <div className="edge-popover-text">{label}</div>}
              <div className="edge-move-hint">Drag a line end to move it; drag a card dot for a new connection.</div>
              {onDelete && (
                <button type="button" className="edge-delete" onClick={() => onDelete(id)}>
                  Delete connection
                </button>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { connection: ConnectionEdge };

export function ThoughtMap(props: ThoughtMapProps) {
  // Provider so child controls (e.g. "New card") can read the viewport via
  // useReactFlow even though they sit outside the <ReactFlow> subtree.
  return (
    <ReactFlowProvider>
      <ThoughtMapInner {...props} />
    </ReactFlowProvider>
  );
}

function ThoughtMapInner({
  store,
  bank,
  confirmed,
  coachDebug,
  commandAck,
  revision,
  questionBias,
  onQuestionBiasChange,
  requireConnectionLabel,
  onRequireConnectionLabelChange,
  canUndo,
  onUndo,
  onBeforeMapChange,
  onStoreChange,
}: ThoughtMapProps) {
  const flow = useReactFlow();
  const visibleCardCount = store.getAll().filter((unit) => unit.role !== "connection_label").length;
  const [showDebug, setShowDebug] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [connectionPanelKey, setConnectionPanelKey] = useState(0);

  const commitText = useCallback(
    (id: string, text: string) => {
      onBeforeMapChange();
      store.editText(id, text, bank);
      onStoreChange();
    },
    [bank, onBeforeMapChange, onStoreChange, store],
  );

  const pullOut = useCallback(
    (id: string) => {
      onBeforeMapChange();
      store.setParent(id, undefined, "node");
      onStoreChange();
    },
    [onBeforeMapChange, onStoreChange, store],
  );

  const promote = useCallback(
    (id: string) => {
      onBeforeMapChange();
      store.swapTitle(id);
      onStoreChange();
    },
    [onBeforeMapChange, onStoreChange, store],
  );

  const deleteCard = useCallback(
    (id: string) => {
      onBeforeMapChange();
      store.delete(id);
      onStoreChange();
    },
    [onBeforeMapChange, onStoreChange, store],
  );

  const deleteConnection = useCallback(
    (id: string) => {
      onBeforeMapChange();
      store.deleteConnection(id);
      onStoreChange();
    },
    [onBeforeMapChange, onStoreChange, store],
  );

  // Auto-clean: tidy scattered cards using direction-aware placement. Only root
  // cards are canvas nodes; nested cards travel with their parent. Each card is
  // placed on the side its connection actually attaches to (a card linked from
  // another's left lands to its left, etc.), so the arrangement matches the
  // connectors' geometry and edges stay short and straight.
  const autoClean = useCallback(() => {
    const roots = store
      .getAll()
      .filter((unit) => !unit.parentId && unit.role !== "connection_label");
    if (roots.length === 0) return;

    const rootIds = new Set(roots.map((u) => u.id));
    // Resolve any card id to its top-level (canvas) ancestor.
    const rootOf = (id: string): string | undefined => {
      let cur = store.get(id);
      const seen = new Set<string>();
      while (cur?.parentId && !seen.has(cur.id)) {
        seen.add(cur.id);
        cur = store.get(cur.parentId);
      }
      return cur?.id;
    };
    const size = (id: string) => store.getSize(id) ?? { w: CARD_WIDTH, h: CARD_HEIGHT };

    // Undirected adjacency (for components) + directed edges (for dagre flow).
    const adj = new Map<string, Set<string>>();
    roots.forEach((u) => adj.set(u.id, new Set()));
    const edges: Array<{ from: string; to: string }> = [];
    for (const c of store.getConnections()) {
      const a = rootOf(c.sourceId);
      const b = rootOf(c.targetId);
      if (!a || !b || a === b || !rootIds.has(a) || !rootIds.has(b)) continue;
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
      edges.push({ from: a, to: b });
    }

    // Connected components, seeded in the user's rough reading order so the
    // tidied layout keeps a familiar left-to-right / top-to-bottom sense.
    const orderedRoots = [...roots].sort((x, y) => {
      const px = store.getPosition(x.id) ?? { x: 0, y: 0 };
      const py = store.getPosition(y.id) ?? { x: 0, y: 0 };
      return px.y - py.y || px.x - py.x;
    });
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

    // Lay each component out top-down with dagre (clean rank flow, minimal
    // crossings), then pack components left-to-right and wrap to a new row past
    // a max width — so unconnected cards spread across the canvas instead of
    // stacking, while connected trees stay compact.
    const GAP = 120;
    const ORIGIN_X = 80;
    const ORIGIN_Y = 80;
    const MAX_ROW_WIDTH = 2400;

    onBeforeMapChange();

    let cursorX = ORIGIN_X;
    let cursorY = ORIGIN_Y;
    let rowHeight = 0;
    for (const comp of components) {
      const compSet = new Set(comp);
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90, marginx: 0, marginy: 0 });
      g.setDefaultEdgeLabel(() => ({}));
      for (const id of comp) {
        const s = size(id);
        g.setNode(id, { width: s.w, height: s.h });
      }
      for (const e of edges) {
        if (compSet.has(e.from) && compSet.has(e.to)) g.setEdge(e.from, e.to);
      }
      dagre.layout(g);

      // dagre reports node centers; normalize to the component's top-left.
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

      // Wrap to a new row if this component would overflow the row width.
      if (cursorX > ORIGIN_X && cursorX + compW > ORIGIN_X + MAX_ROW_WIDTH) {
        cursorX = ORIGIN_X;
        cursorY += rowHeight + GAP;
        rowHeight = 0;
      }

      for (const id of comp) {
        const n = g.node(id);
        const s = size(id);
        store.setPosition(id, {
          x: cursorX + (n.x - s.w / 2 - minX),
          y: cursorY + (n.y - s.h / 2 - minY),
        });
      }
      cursorX += compW + GAP;
      rowHeight = Math.max(rowHeight, compH);
    }

    onStoreChange();

    // Re-frame the tidied map after the nodes re-render.
    setTimeout(() => flow.fitView({ padding: 0.2 }), 0);
  }, [flow, onBeforeMapChange, onStoreChange, store]);

  const resizeStart = useCallback(
    (
      id: string,
      edges: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean },
      event: React.MouseEvent,
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const startPosition = store.getPosition(id) ?? { x: 80, y: 80 };
      const startSize = store.getSize(id) ?? { w: CARD_WIDTH, h: CARD_HEIGHT };
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = flow.getZoom() || 1;

      onBeforeMapChange();

      const onMove = (moveEvent: MouseEvent) => {
        const dx = (moveEvent.clientX - startX) / zoom;
        const dy = (moveEvent.clientY - startY) / zoom;
        let nextX = startPosition.x;
        let nextY = startPosition.y;
        let nextW = startSize.w;
        let nextH = startSize.h;

        if (edges.right) {
          nextW = Math.max(CARD_MIN_WIDTH, startSize.w + dx);
        }
        if (edges.bottom) {
          nextH = Math.max(CARD_MIN_HEIGHT, startSize.h + dy);
        }
        if (edges.left) {
          nextW = Math.max(CARD_MIN_WIDTH, startSize.w - dx);
          nextX = startPosition.x + (startSize.w - nextW);
        }
        if (edges.top) {
          nextH = Math.max(CARD_MIN_HEIGHT, startSize.h - dy);
          nextY = startPosition.y + (startSize.h - nextH);
        }

        store.setPosition(id, { x: nextX, y: nextY });
        store.setSize(id, { w: nextW, h: nextH });
        onStoreChange();
      };

      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [flow, onBeforeMapChange, onStoreChange, store],
  );

  const getChildren = useCallback(
    (id: string) =>
      store.getAll().filter((u) => u.parentId === id && u.role !== "connection_label"),
    // revision so the closure reflects the latest store state on re-render
    [store, revision],
  );

  const actions = useMemo<CardActions>(
    () => ({
      onCommitText: commitText,
      onPullOut: pullOut,
      onPromote: promote,
      onDelete: deleteCard,
      onResizeStart: resizeStart,
      getChildren,
    }),
    [commitText, deleteCard, getChildren, promote, pullOut, resizeStart],
  );

  const addCard = useCallback(() => {
    onBeforeMapChange();
    // Shared non-overlap placement (never stacks on an existing card).
    const unit = store.addBlankUserCard();
    onStoreChange();

    // If the free slot fell outside the current view (canvas is cluttered),
    // zoom out so the new card and the space around it become visible.
    const pos = store.getPosition(unit.id);
    if (!pos) return;
    const size = store.getSize(unit.id) ?? { w: CARD_WIDTH, h: CARD_HEIGHT };
    const topLeft = flow.screenToFlowPosition({ x: 0, y: 0 });
    const bottomRight = flow.screenToFlowPosition({ x: window.innerWidth, y: window.innerHeight });
    const fullyVisible =
      pos.x >= topLeft.x &&
      pos.y >= topLeft.y &&
      pos.x + size.w <= bottomRight.x &&
      pos.y + size.h <= bottomRight.y;
    if (!fullyVisible) {
      setTimeout(() => flow.fitView({ padding: 0.2 }), 0);
    }
  }, [flow, onBeforeMapChange, onStoreChange, store]);

  const onPaneDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(EMBEDDED_CARD_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onPaneDrop = useCallback(
    (event: React.DragEvent) => {
      const id = event.dataTransfer.getData(EMBEDDED_CARD_DRAG_TYPE);
      if (!id) return;
      const unit = store.get(id);
      if (!unit?.parentId || unit.role === "connection_label") return;

      event.preventDefault();
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onBeforeMapChange();
      store.setParent(id, undefined, "node");
      store.setPosition(id, position);
      onStoreChange();
    },
    [flow, onBeforeMapChange, onStoreChange, store],
  );

  const flowNodes = useMemo<ThoughtFlowNode[]>(() => {
    // Only ROOT cards are canvas nodes; nested cards render inside their parent.
    const roots = store
      .getAll()
      .filter((unit) => !unit.parentId && unit.role !== "connection_label");

    const allUnits = store.getAll();
    return roots.map((unit) => {
      const size = store.getSize(unit.id) ?? { w: CARD_WIDTH, h: CARD_HEIGHT };
      const hasChildren = allUnits.some((u) => u.parentId === unit.id);
      return {
        id: unit.id,
        type: "thought",
        position: store.getPosition(unit.id) ?? { x: 80, y: 80 },
        data: {
          unit,
          actions,
          sourceLabel: sourceLabel(unit),
          size,
        },
        // Has-children cards grow with their content, so let the node wrapper
        // size to the card (height auto) instead of pinning it.
        style: hasChildren
          ? { width: size.w }
          : { width: size.w, height: size.h },
        dragHandle: ".map-card-drag",
      };
    });
  }, [actions, revision, store]);

  const [nodes, setNodes, onNodesChange] = useNodesState<ThoughtFlowNode>(flowNodes);

  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  const confirmedEdges = useMemo<Edge[]>(() => {
    return store.getConnections().map((connection) => {
      const label = store.get(connection.labelUnitId);
      return {
        id: connection.id,
        source: connection.sourceId,
        target: connection.targetId,
        sourceHandle: renderHandleId("source", connection.sourceHandleId),
        targetHandle: renderHandleId("target", connection.targetHandleId),
        type: "connection",
        reconnectable: true,
        data: { label: label?.text ?? "", onDelete: deleteConnection },
        className: "map-edge",
      };
    });
  }, [deleteConnection, revision, store]);

  const edges = useMemo<Edge[]>(() => {
    const pendingEdge: Edge | undefined = pendingConnection
      ? {
          id: "pending-connection",
          source: pendingConnection.sourceId,
          target: pendingConnection.targetId,
          sourceHandle: renderHandleId("source", pendingConnection.sourceHandleId ?? undefined),
          targetHandle: renderHandleId("target", pendingConnection.targetHandleId ?? undefined),
          animated: true,
          label: pendingConnection.text,
          type: "smoothstep",
          className: "map-edge pending",
        }
      : undefined;
    return pendingEdge ? [...confirmedEdges, pendingEdge] : confirmedEdges;
  }, [confirmedEdges, pendingConnection]);

  const [dropTargetId, setDropTargetId] = useState<string | undefined>(undefined);

  // Apply the drop-target class without disturbing node state — derived per render.
  const displayNodes = useMemo<ThoughtFlowNode[]>(
    () =>
      dropTargetId
        ? nodes.map((node) =>
            node.id === dropTargetId
              ? { ...node, className: `${node.className ?? ""} drop-target`.trim() }
              : node,
          )
        : nodes,
    [nodes, dropTargetId],
  );

  // Live drop-target highlight: while a card is dragged, mark the card it would
  // nest into so the user sees the target before releasing. No commit happens
  // until drag stop — this is pure visual feedback over the existing behavior.
  const onNodeDrag = useCallback(
    (_event: MouseEvent | TouchEvent, node: ThoughtFlowNode) => {
      const dragged = store.get(node.id);
      if (!dragged || dragged.role === "connection_label") {
        setDropTargetId(undefined);
        return;
      }
      const target = findDropTarget(node, nodes);
      const targetUnit = target ? store.get(target.id) : undefined;
      const valid =
        targetUnit &&
        targetUnit.role !== "connection_label" &&
        !store.wouldCycle(dragged.id, targetUnit.id);
      setDropTargetId(valid && targetUnit ? targetUnit.id : undefined);
    },
    [nodes, store],
  );

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: ThoughtFlowNode) => {
      setDropTargetId(undefined);
      onBeforeMapChange();
      store.setPosition(node.id, node.position);

      const dragged = store.get(node.id);
      if (!dragged || dragged.role === "connection_label") {
        onStoreChange();
        return;
      }

      const target = findDropTarget(node, nodes);
      const targetUnit = target ? store.get(target.id) : undefined;
      const validTarget =
        targetUnit &&
        targetUnit.role !== "connection_label" &&
        !store.wouldCycle(dragged.id, targetUnit.id);
      if (validTarget && targetUnit) {
        const hasChildren = store.getAll().some((unit) => unit.parentId === dragged.id);
        if (targetUnit.role === "content") store.setRole(targetUnit.id, "subnode");
        store.setParent(dragged.id, targetUnit.id, hasChildren ? "subnode" : "content");
      }

      onStoreChange();
    },
    [nodes, onBeforeMapChange, onStoreChange, store],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      // Connection-label cards are not valid relationship endpoints.
      const source = store.get(connection.source);
      const target = store.get(connection.target);
      if (!source || !target) return;
      if (source.role === "connection_label" || target.role === "connection_label") return;
      if (!requireConnectionLabel) {
        onBeforeMapChange();
        store.registerConnection({
          sourceId: connection.source,
          targetId: connection.target,
          text: "",
          bank,
          sourceHandleId: anchorHandleId(connection.sourceHandle),
          targetHandleId: anchorHandleId(connection.targetHandle),
          position: connectionMidpoint(store, connection.source, connection.target),
        });
        onStoreChange();
        return;
      }
      setPendingConnection({
        sourceId: connection.source,
        targetId: connection.target,
        sourceHandleId: anchorHandleId(connection.sourceHandle),
        targetHandleId: anchorHandleId(connection.targetHandle),
        text: "",
      });
      setConnectionPanelKey((key) => key + 1);
    },
    [bank, onBeforeMapChange, onStoreChange, requireConnectionLabel, store],
  );

  const onReconnect = useCallback<OnReconnect<Edge>>(
    (oldEdge, connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const source = store.get(connection.source);
      const target = store.get(connection.target);
      if (!source || !target) return;
      if (source.role === "connection_label" || target.role === "connection_label") return;
      onBeforeMapChange();
      store.reconnect(
        oldEdge.id,
        connection.source,
        connection.target,
        anchorHandleId(connection.sourceHandle),
        anchorHandleId(connection.targetHandle),
      );
      onStoreChange();
    },
    [onBeforeMapChange, onStoreChange, store],
  );

  const cancelConnection = useCallback(() => {
    setPendingConnection(null);
  }, []);

  // One step: wording is optional, confirm once. Empty wording writes nothing
  // to the bank (registerConnection handles that).
  const confirmConnection = useCallback(() => {
    if (!pendingConnection) return;
    onBeforeMapChange();
    store.registerConnection({
      sourceId: pendingConnection.sourceId,
      targetId: pendingConnection.targetId,
      text: pendingConnection.text,
      bank,
      sourceHandleId: pendingConnection.sourceHandleId,
      targetHandleId: pendingConnection.targetHandleId,
      position: connectionMidpoint(store, pendingConnection.sourceId, pendingConnection.targetId),
    });
    setPendingConnection(null);
    onStoreChange();
  }, [bank, onBeforeMapChange, onStoreChange, pendingConnection, store]);

  const sourceUnit = pendingConnection ? store.get(pendingConnection.sourceId) : undefined;
  const targetUnit = pendingConnection ? store.get(pendingConnection.targetId) : undefined;

  return (
    <section className="map-panel">
      <div className="map-header">
        <div>
          <h2>Concept map</h2>
          <span className="map-count">{visibleCardCount} cards</span>
        </div>

        {commandAck && (
          <div className="map-command-ack" role="status">
            <span>{commandAck.text}</span>
            <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo this map command">
              Undo
            </button>
          </div>
        )}

        <label className="question-bias">
          <span>Think</span>
          <input
            type="range"
            min={0}
            max={100}
            value={questionBias}
            aria-label="Question framing bias"
            onChange={(event) => onQuestionBiasChange(Number(event.target.value))}
          />
          <span>Map</span>
        </label>

        <button type="button" className="map-add-card" onClick={addCard}>
          + New card
        </button>

        <button
          type="button"
          className={`map-label-toggle ${requireConnectionLabel ? "active" : ""}`}
          onClick={() => onRequireConnectionLabelChange(!requireConnectionLabel)}
          title={requireConnectionLabel ? "Ask for relationship wording on new connections" : "Create unlabeled connections immediately"}
        >
          Label {requireConnectionLabel ? "on" : "off"}
        </button>

        <button type="button" className="map-clean" onClick={autoClean} title="Tidy the map: lay connected cards into clean trees and spread the rest across the canvas">
          Auto-clean
        </button>

        <button type="button" className="map-undo" onClick={onUndo} disabled={!canUndo} title="Undo map change">
          Undo
        </button>

        <button type="button" className="map-debug-toggle" onClick={() => setShowDebug((v) => !v)}>
          Debug
        </button>
      </div>

      <p className="map-hint">
        Drag a card onto another to nest it inside · use "Out" to separate ·
        drag a card dot to connect · drag a line end to move a connector
      </p>

      <div className="map-canvas">
        {visibleCardCount === 0 && <div className="map-empty">No cards yet</div>}
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onDragOver={onPaneDragOver}
          onDrop={onPaneDrop}
          onConnect={onConnect}
          onReconnect={onReconnect}
          connectionMode={ConnectionMode.Loose}
          edgesReconnectable
          reconnectRadius={14}
          fitView
          fitViewOptions={{ padding: 0.2 }}
        >
          <Background gap={28} size={1} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>

        {pendingConnection && (
          <div key={connectionPanelKey} className="connection-panel blink">
            <div className="connection-panel-meta">
              <span>{sourceUnit?.text ?? "source"}</span>
              <span>to</span>
              <span>{targetUnit?.text ?? "target"}</span>
            </div>
            <textarea
              className="connection-input"
              value={pendingConnection.text}
              autoFocus
              onChange={(event) =>
                setPendingConnection({ ...pendingConnection, text: event.target.value })
              }
              placeholder="Relationship wording (optional)"
            />
            <div className="connection-actions">
              <button type="button" onClick={confirmConnection}>
                Connect
              </button>
              <button type="button" className="connection-cancel" onClick={cancelConnection}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {showDebug && (
          <div className="map-debug">
            <div className="map-debug-title">Last coach decision</div>
            {coachDebug ? (
              <div className="map-debug-item">
                <span>{coachDebug.mode}</span>
                <small>{coachDebug.suppressionReason ?? "not suppressed"}</small>
                {coachDebug.suppressionDetail && <span>{coachDebug.suppressionDetail}</span>}
                {coachDebug.acceleratedCandidateIds && coachDebug.acceleratedCandidateIds.length > 0 && (
                  <span>accelerated: {coachDebug.acceleratedCandidateIds.join(", ")}</span>
                )}
                {coachDebug.readinessNotes?.map((note) => (
                  <span key={note}>{note}</span>
                ))}
                {coachDebug.commandDebug?.map((note, index) => (
                  <span key={`${note.reason}-${index}`}>
                    command {note.reason}: {note.detail}
                  </span>
                ))}
                {coachDebug.validationDebug?.map((claim) => (
                  <div key={claim.claimId} className="map-debug-validation">
                    <span>claim: {claim.claimText}</span>
                    <small>{claim.target || "unknown target"}</small>
                    {claim.checks.map((check) => (
                      <span key={check.check}>
                        {check.check}: {check.ok ? "ok" : "failed"} {scoreText(check.score, check.threshold)}
                        {check.parts && check.parts.length > 0
                          ? ` (${check.parts
                              .map((part) => `${part.name} ${scoreText(part.score, part.threshold)}`)
                              .join("; ")})`
                          : ""}
                      </span>
                    ))}
                    {claim.sourceSpans.map((span, index) => (
                      <div key={`${claim.claimId}-span-${index}`} className="map-debug-span">
                        <span>span phrase: {span.userPhrase}</span>
                        <small>ids: {span.utteranceIds.join(", ") || "none"}</small>
                        {span.citedUtterances.map((utterance) => (
                          <span key={utterance.id}>
                            {utterance.id}: {utterance.text}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p>None</p>
            )}
            <div className="map-debug-title">Confirmed reflections</div>
            {confirmed.length === 0 ? (
              <p>None</p>
            ) : (
              confirmed.map((item) => (
                <div key={item.id} className="map-debug-item">
                  <span>{item.text}</span>
                  <small>{item.target}</small>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
