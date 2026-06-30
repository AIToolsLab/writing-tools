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
import type { ThoughtUnitStore, XYPosition, XYSize } from "./map-store";
import type { SourceBank } from "./store";
import type { ConfirmedReflection, ThoughtUnit } from "./types";

const CARD_WIDTH = 260;
const CARD_HEIGHT = 140;
const CARD_MIN_WIDTH = 180;
const CARD_MIN_HEIGHT = 110;

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
  if (unit.role === "connection_label") return "connection";
  if (childCount > 0) return "title";
  if (unit.role === "subnode") return "subnode";
  if (unit.role === "content") return "member";
  return "card";
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
  useEffect(() => setDraft(unit.text), [unit.id, unit.text]);
  const children = actions.getChildren(unit.id);

  return (
    <div className={`map-embed role-${unit.role}`}>
      <textarea
        className="map-embed-editor nodrag"
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

  return (
    <div
      className={`map-card ${selected ? "selected" : ""} role-${unit.role} ${
        children.length > 0 ? "has-children" : ""
      }`}
      style={{ width: size.w, height: size.h }}
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

      <div className="map-card-drag">
        <span className="map-role-chip">{roleLabel(unit, children.length)}</span>
      </div>

      <textarea
        className="map-card-editor nodrag"
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
        <button type="button" onClick={() => actions.onDelete(unit.id)} title="Delete card">
          ✕
        </button>
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
    // Drop the new card near the center of the visible canvas, not at a fixed
    // grid slot that can march offscreen.
    const pos = flow.screenToFlowPosition({
      x: window.innerWidth * 0.6,
      y: window.innerHeight * 0.45,
    });
    onBeforeMapChange();
    store.addBlankUserCard(pos);
    onStoreChange();
  }, [flow, onBeforeMapChange, onStoreChange, store]);

  const flowNodes = useMemo<ThoughtFlowNode[]>(() => {
    // Only ROOT cards are canvas nodes; nested cards render inside their parent.
    const roots = store
      .getAll()
      .filter((unit) => !unit.parentId && unit.role !== "connection_label");

    return roots.map((unit) => ({
      id: unit.id,
      type: "thought",
      position: store.getPosition(unit.id) ?? { x: 80, y: 80 },
      data: {
        unit,
        actions,
        sourceLabel: sourceLabel(unit),
        size: store.getSize(unit.id) ?? { w: CARD_WIDTH, h: CARD_HEIGHT },
      },
      style: store.getSize(unit.id)
        ? { width: store.getSize(unit.id)?.w, height: store.getSize(unit.id)?.h }
        : { width: CARD_WIDTH, height: CARD_HEIGHT },
      dragHandle: ".map-card-drag",
    }));
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

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: ThoughtFlowNode) => {
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
          <span className="map-count">{store.getAll().length} cards</span>
        </div>

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
        {store.getAll().length === 0 && <div className="map-empty">No cards yet</div>}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
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
