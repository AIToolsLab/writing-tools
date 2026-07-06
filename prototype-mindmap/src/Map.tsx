import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  MiniMap,
  ConnectionMode,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnConnectStart,
  type OnConnectEnd,
  type OnReconnect,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { computeAutoCleanPositions, computeConnectionHandles } from "./map-layout";
import type { ConnectionLayoutDirection, ThoughtUnitStore, XYBounds, XYPosition, XYSize } from "./map-store";
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
  layoutDirection?: ConnectionLayoutDirection;
  /**
   * Connector-to-empty-canvas with "Label on": the card on this `side` does not
   * exist yet and is created only when the user confirms. Deferring creation
   * means Cancel leaves nothing behind and Confirm is a single undoable action.
   * The id on that side is an empty placeholder until confirm.
   */
  createCard?: { position: XYPosition; side: "source" | "target" };
}

interface ConnectionEdgeData extends Record<string, unknown> {
  label: string;
  layoutDirection: ConnectionLayoutDirection;
  onDelete?: (id: string) => void;
  onDirectionChange?: (id: string, direction: ConnectionLayoutDirection) => void;
  /** Perpendicular offset so nearby badges don't stack (see badgeOffsets). */
  badgeOffset?: { dx: number; dy: number };
  /** Concrete card refs/text so the direction popover names real cards. */
  sourceRef?: string;
  targetRef?: string;
  sourceText?: string;
  targetText?: string;
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
type AnchorProxyFlowNode = Node<Record<string, unknown>, "anchorProxy">;
type MapFlowNode = ThoughtFlowNode | AnchorProxyFlowNode;

/** Rendered offset/size of a nested card, relative to its root canvas node. */
interface ProxyGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

function proxyGeometryEqual(
  a: Record<string, ProxyGeometry>,
  b: Record<string, ProxyGeometry>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const prev = a[key];
    const next = b[key];
    if (!next) return false;
    return (
      Math.abs(prev.x - next.x) < 0.5 &&
      Math.abs(prev.y - next.y) < 0.5 &&
      Math.abs(prev.w - next.w) < 0.5 &&
      Math.abs(prev.h - next.h) < 0.5
    );
  });
}

/**
 * Legacy nested-endpoint edges used invisible proxy anchors. Connections now
 * normalize to root cards in the store, so this deliberately returns no proxies:
 * rendering a proxy would preserve corrupt state instead of surfacing it.
 */
export function proxyAnchorSpecs(
  _units: ThoughtUnit[],
  _connections: Array<{ sourceId: string; targetId: string }>,
): Array<{ id: string; rootId: string }> {
  return [];
}

interface ThoughtMapProps {
  store: ThoughtUnitStore;
  bank: SourceBank;
  confirmed: ConfirmedReflection[];
  coachDebug?: CoachDebugInfo | null;
  /** Docked-draft affordance, rendered in the map header when the draft is docked. */
  draftDock?: ReactNode;
  draftDockSlot?: ReactNode;
  /** True while the floating draft chip is hovering over the header dock zone. */
  draftDockActive?: boolean;
  commandAck?: MapCommandAcknowledgement | null;
  /** Card ids the current coach turn refers to (by #ref) — highlighted on the canvas. */
  highlightedCardIds?: ReadonlySet<string>;
  revision: number;
  requireConnectionLabel: boolean;
  onRequireConnectionLabelChange: (value: boolean) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClearDraft: () => void;
  onClearMap: () => void;
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
    // Invisible proxy anchors (nested-connection endpoints) are not drop targets.
    if (node.type !== "thought") return false;
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

function visibleFlowBounds(
  flow: ReturnType<typeof useReactFlow>,
  element: HTMLElement | null,
): XYBounds | undefined {
  const rect = element?.getBoundingClientRect();
  if (!rect) return undefined;
  const inset = 24;
  const topLeft = flow.screenToFlowPosition({ x: rect.left + inset, y: rect.top + inset });
  const bottomRight = flow.screenToFlowPosition({ x: rect.right - inset, y: rect.bottom - inset });
  return {
    left: Math.min(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    right: Math.max(topLeft.x, bottomRight.x),
    bottom: Math.max(topLeft.y, bottomRight.y),
  };
}

function measuredRootSizes(
  flow: ReturnType<typeof useReactFlow>,
  store: ThoughtUnitStore,
): Record<string, XYSize> {
  const sizes = store.getSizes();
  for (const node of flow.getNodes()) {
    const unit = store.get(node.id);
    if (!unit || unit.parentId || unit.role === "connection_label") continue;
    const width = node.measured?.width ?? node.width;
    const height = node.measured?.height ?? node.height;
    if (typeof width !== "number" || typeof height !== "number") continue;
    if (width <= 0 || height <= 0) continue;
    sizes[node.id] = { w: width, h: height };
  }
  return sizes;
}

export function renderedEndpointCenter(
  store: ThoughtUnitStore,
  id: string,
  defaultSize: XYSize,
): XYPosition | undefined {
  let unit = store.get(id);
  if (!unit || unit.role === "connection_label") return undefined;

  if (!unit.parentId) {
    const position = store.getPosition(unit.id);
    if (!position) return undefined;
    const size = store.getSize(unit.id) ?? defaultSize;
    return { x: position.x + size.w / 2, y: position.y + size.h / 2 };
  }

  const seen = new Set<string>();
  while (unit.parentId) {
    if (seen.has(unit.id)) return undefined;
    seen.add(unit.id);
    const parent = store.get(unit.parentId);
    if (!parent || parent.role === "connection_label") return undefined;
    unit = parent;
  }

  const position = store.getPosition(unit.id);
  if (!position) return undefined;
  const size = store.getSize(unit.id) ?? defaultSize;
  return { x: position.x + size.w / 2, y: position.y + size.h / 2 };
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
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setDraft(unit.text), [unit.id, unit.text]);
  const children = actions.getChildren(unit.id);
  const rows = expanded ? embeddedTextareaRows(draft) : 2;

  return (
    <div
      className={`map-embed role-${unit.role} ${dragging ? "dragging" : ""} ${expanded ? "expanded" : ""}`}
      data-card-id={unit.id}
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
      <span className="map-embed-drag-grip" role="img" aria-label="Drag nested card" title="Drag nested card" />
      <textarea
        className="map-embed-editor nodrag nowheel"
        value={draft}
        rows={rows}
        placeholder="(empty)"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== unit.text) actions.onCommitText(unit.id, draft);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      />
      <div className="map-embed-actions nodrag">
        <span className="map-embed-ref" title="Card reference">{cardRef(unit.id)}</span>
        <button type="button" onClick={() => setExpanded((value) => !value)} title={expanded ? "Collapse card text" : "Expand card text"}>
          {expanded ? "Less" : "More"}
        </button>
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

function embeddedTextareaRows(text: string): number {
  const normalized = text || "";
  const visualLines = normalized
    .split(/\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 42)), 0);
  return Math.max(3, visualLines + 1);
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
        <span className="map-drag-grip" role="img" aria-label="Drag card" title="Drag card" />
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

/**
 * Invisible node standing in for a nested card as a connection endpoint. It
 * renders only the connection handles (transparent, non-interactive) so React
 * Flow can attach the edge at the embedded card's on-screen position.
 */
function AnchorProxyNode(_props: NodeProps<AnchorProxyFlowNode>) {
  return (
    <div className="map-proxy-anchor">
      <ConnectionHandles />
    </div>
  );
}

const nodeTypes = { thought: ThoughtCardNode, anchorProxy: AnchorProxyNode };

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
  markerStart,
  markerEnd,
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
  const edgeData = data as Partial<ConnectionEdgeData> | undefined;
  const label = typeof edgeData?.label === "string" ? edgeData.label : "";
  const layoutDirection = edgeData?.layoutDirection ?? "none";
  const onDelete = edgeData?.onDelete;
  const onDirectionChange = edgeData?.onDirectionChange;
  const offset = edgeData?.badgeOffset ?? { dx: 0, dy: 0 };
  const badgeX = labelX + offset.dx;
  const badgeY = labelY + offset.dy;
  const sourceRef = edgeData?.sourceRef ?? "source";
  const targetRef = edgeData?.targetRef ?? "target";
  const sourceText = edgeData?.sourceText ?? "";
  const targetText = edgeData?.targetText ?? "";

  // Concrete direction choices named by real card refs, so the user can tell
  // which card feeds into which instead of abstract "source/target".
  const directionOptions = [
    { value: "none" as const, glyph: "↔", label: "No arrow", hint: "Neutral: keep close without ordering" },
    {
      value: "source_to_target" as const,
      glyph: "→",
      label: `${sourceRef} → ${targetRef}`,
      hint: `${sourceRef} sits before/above ${targetRef}`,
    },
    {
      value: "target_to_source" as const,
      glyph: "←",
      label: `${targetRef} → ${sourceRef}`,
      hint: `${targetRef} sits before/above ${sourceRef}`,
    },
  ];

  return (
    <>
      <BaseEdge id={id} path={edgePath} className="map-edge" markerStart={markerStart} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className={`edge-badge-wrap nodrag nopan ${open ? "open" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${badgeX}px, ${badgeY}px)` }}
        >
          <button
            type="button"
            className={`edge-badge ${open ? "active" : ""}`}
            title={label || "connection"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "×" : "↔"}
          </button>
          {open && (
            <div className="edge-popover" role="dialog" aria-label="Connection">
              <div className="edge-popover-cards">
                <span className="edge-popover-card"><b>{sourceRef}</b> {shortenEdgeText(sourceText)}</span>
                <span className="edge-popover-card"><b>{targetRef}</b> {shortenEdgeText(targetText)}</span>
              </div>
              {label && <div className="edge-popover-text">"{label}"</div>}
              {onDirectionChange && (
                <div className="edge-direction">
                  <span className="edge-direction-title">Arrow direction</span>
                  <div className="edge-direction-buttons" role="group" aria-label="Arrow direction">
                    {directionOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={layoutDirection === option.value ? "active" : ""}
                        onClick={() => onDirectionChange(id, option.value)}
                        title={option.hint}
                      >
                        <span className="edge-direction-glyph">{option.glyph}</span>
                        <span className="edge-direction-label">{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

function shortenEdgeText(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return "";
  return compact.length <= 26 ? compact : `${compact.slice(0, 24).trim()}…`;
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
  draftDock,
  draftDockSlot,
  draftDockActive,
  commandAck,
  highlightedCardIds,
  revision,
  requireConnectionLabel,
  onRequireConnectionLabelChange,
  canUndo,
  onUndo,
  onClearDraft,
  onClearMap,
  onBeforeMapChange,
  onStoreChange,
}: ThoughtMapProps) {
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const visibleCardCount = store.getAll().filter((unit) => unit.role !== "connection_label").length;
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

  const setConnectionDirection = useCallback(
    (id: string, direction: ConnectionLayoutDirection) => {
      onBeforeMapChange();
      store.setConnectionLayoutDirection(id, direction);
      onStoreChange();
    },
    [onBeforeMapChange, onStoreChange, store],
  );

  // Auto-clean: tidy scattered root-level cards using direction-aware placement.
  // Nested cards are not positioned directly; they travel with their parent.
  const autoClean = useCallback(() => {
    const units = store.getAll();
    const connections = store.getConnections();
    const sizes = measuredRootSizes(flow, store);
    const defaultSize = { w: CARD_WIDTH, h: CARD_HEIGHT };
    const nextPositions = computeAutoCleanPositions({
      units,
      connections,
      positions: store.getPositions(),
      sizes,
      defaultSize,
    });
    if (Object.keys(nextPositions).length === 0) return;

    onBeforeMapChange();
    for (const [id, position] of Object.entries(nextPositions)) {
      store.setPosition(id, position);
    }

    // Route connectors onto the facing sides for the new geometry so lines don't
    // cut through card interiors. rootOf resolves a nested endpoint to the card
    // that actually renders it.
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
    const handleAssignments = computeConnectionHandles({
      connections,
      positions: { ...store.getPositions(), ...nextPositions },
      sizes,
      defaultSize,
      rootOf,
    });
    for (const assignment of handleAssignments) {
      store.setConnectionHandles(assignment.connectionId, assignment.sourceHandleId, assignment.targetHandleId);
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
    const viewportBounds = visibleFlowBounds(flow, canvasRef.current);
    const visibleSlot = viewportBounds ? store.nextRootPositionWithin(viewportBounds) : undefined;
    // Prefer a free slot inside the visible canvas before falling back to the
    // wider map placement search.
    const unit = store.addBlankUserCard(visibleSlot);
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

  const [proxyGeometry, setProxyGeometry] = useState<Record<string, ProxyGeometry>>({});

  const flowNodes = useMemo<MapFlowNode[]>(() => {
    // Only ROOT cards are canvas nodes; nested cards render inside their parent.
    const allUnits = store.getAll();
    const roots = allUnits.filter((unit) => !unit.parentId && unit.role !== "connection_label");

    const rootNodes: MapFlowNode[] = roots.map((unit) => {
      const size = store.getSize(unit.id) ?? { w: CARD_WIDTH, h: CARD_HEIGHT };
      const hasChildren = allUnits.some((u) => u.parentId === unit.id);
      return {
        id: unit.id,
        type: "thought" as const,
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

    // The store normalizes connection endpoints to root cards. This legacy hook
    // intentionally produces no nested endpoint proxies.
    const proxyNodes: MapFlowNode[] = proxyAnchorSpecs(allUnits, store.getConnections()).map(
      ({ id, rootId }) => {
        const measured = proxyGeometry[id];
        return {
          id,
          type: "anchorProxy" as const,
          parentId: rootId,
          // Until measured, land roughly over the parent's children area.
          position: measured ? { x: measured.x, y: measured.y } : { x: 16, y: 48 },
          draggable: false,
          selectable: false,
          focusable: false,
          connectable: false,
          style: {
            width: measured?.w ?? 48,
            height: measured?.h ?? 28,
            pointerEvents: "none" as const,
          },
          data: {},
        };
      },
    );

    return [...rootNodes, ...proxyNodes];
  }, [actions, proxyGeometry, revision, store]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MapFlowNode>(flowNodes);

  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  // Legacy proxy geometry path. `proxyAnchorSpecs` now returns no specs because
  // connection endpoints normalize to root cards in the store.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const zoom = flow.getZoom() || 1;
      const next: Record<string, ProxyGeometry> = {};
      for (const spec of proxyAnchorSpecs(store.getAll(), store.getConnections())) {
        const rootEl = canvasRef.current?.querySelector(
          `.react-flow__node[data-id="${spec.rootId}"]`,
        );
        const childEl = rootEl?.querySelector(`[data-card-id="${spec.id}"]`);
        if (!rootEl || !childEl) continue;
        const rootRect = rootEl.getBoundingClientRect();
        const childRect = childEl.getBoundingClientRect();
        next[spec.id] = {
          x: (childRect.left - rootRect.left) / zoom,
          y: (childRect.top - rootRect.top) / zoom,
          w: childRect.width / zoom,
          h: childRect.height / zoom,
        };
      }
      setProxyGeometry((prev) => (proxyGeometryEqual(prev, next) ? prev : next));
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, nodes, revision, store]);

  // Rendered center of a connection endpoint. Endpoints should be root cards;
  // the nested fallback is defensive for stale in-memory state.
  const endpointCenter = useCallback(
    (id: string): XYPosition | undefined => {
      return renderedEndpointCenter(store, id, { w: CARD_WIDTH, h: CARD_HEIGHT });
    },
    [store],
  );

  // Perpendicular badge offsets so edge badges with nearby midpoints (e.g. two
  // connectors between close cards) stagger apart instead of stacking into one
  // unreadable pile. Each badge stays tethered to its own edge.
  const badgeOffsets = useMemo<Record<string, { dx: number; dy: number }>>(() => {
    const STAGGER = 24;
    const BUCKET = 44;
    const mids = store.getConnections().map((connection) => {
      const s = endpointCenter(connection.sourceId);
      const t = endpointCenter(connection.targetId);
      if (!s || !t) return { id: connection.id, mid: undefined, perp: { x: 0, y: 0 } };
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        id: connection.id,
        mid: { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 },
        perp: { x: -dy / len, y: dx / len },
      };
    });
    const buckets = new Map<string, typeof mids>();
    for (const m of mids) {
      if (!m.mid) continue;
      const key = `${Math.round(m.mid.x / BUCKET)}:${Math.round(m.mid.y / BUCKET)}`;
      const arr = buckets.get(key) ?? [];
      arr.push(m);
      buckets.set(key, arr);
    }
    const offsets: Record<string, { dx: number; dy: number }> = {};
    for (const arr of buckets.values()) {
      arr.forEach((m, index) => {
        const k = index - (arr.length - 1) / 2;
        offsets[m.id] = { dx: m.perp.x * k * STAGGER, dy: m.perp.y * k * STAGGER };
      });
    }
    return offsets;
  }, [endpointCenter, revision, store]);

  const confirmedEdges = useMemo<Edge[]>(() => {
    return store.getConnections().map((connection) => {
      const label = store.get(connection.labelUnitId);
      return {
        id: connection.id,
        source: connection.sourceId,
        target: connection.targetId,
        sourceHandle: renderHandleId("source", connection.sourceHandleId),
        targetHandle: renderHandleId("target", connection.targetHandleId),
        markerEnd:
          connection.layoutDirection === "source_to_target"
            ? { type: MarkerType.ArrowClosed, width: 18, height: 18 }
            : undefined,
        markerStart:
          connection.layoutDirection === "target_to_source"
            ? { type: MarkerType.ArrowClosed, width: 18, height: 18 }
            : undefined,
        type: "connection",
        reconnectable: true,
        data: {
          label: label?.text ?? "",
          layoutDirection: connection.layoutDirection,
          onDelete: deleteConnection,
          onDirectionChange: setConnectionDirection,
          badgeOffset: badgeOffsets[connection.id],
          sourceRef: cardRef(connection.sourceId),
          targetRef: cardRef(connection.targetId),
          sourceText: store.get(connection.sourceId)?.text ?? "",
          targetText: store.get(connection.targetId)?.text ?? "",
        },
        className: "map-edge",
      };
    });
  }, [badgeOffsets, deleteConnection, revision, setConnectionDirection, store]);

  const edges = useMemo<Edge[]>(() => {
    // A deferred connector-to-canvas connection has one endpoint that doesn't
    // exist yet (id is ""), so it must NOT render a pending edge — React Flow
    // would warn and draw a broken line to a missing node. The label panel is the
    // only affordance shown until the user confirms and the card is created.
    const pendingEdge: Edge | undefined = pendingConnection && !pendingConnection.createCard
      ? {
          id: "pending-connection",
          source: pendingConnection.sourceId,
          target: pendingConnection.targetId,
          sourceHandle: renderHandleId("source", pendingConnection.sourceHandleId ?? undefined),
          targetHandle: renderHandleId("target", pendingConnection.targetHandleId ?? undefined),
          animated: true,
          label: pendingConnection.text,
          data: { layoutDirection: pendingConnection.layoutDirection ?? "none" },
          type: "smoothstep",
          className: "map-edge pending",
        }
      : undefined;
    return pendingEdge ? [...confirmedEdges, pendingEdge] : confirmedEdges;
  }, [confirmedEdges, pendingConnection]);

  const [dropTargetId, setDropTargetId] = useState<string | undefined>(undefined);

  // Apply drop-target and coach-reference highlight classes without disturbing
  // node state — derived per render.
  const displayNodes = useMemo<MapFlowNode[]>(
    () =>
      nodes.map((node) => {
        const extra: string[] = [];
        if (node.id === dropTargetId) extra.push("drop-target");
        if (highlightedCardIds?.has(node.id)) extra.push("referenced");
        if (extra.length === 0) return node;
        return { ...node, className: `${node.className ?? ""} ${extra.join(" ")}`.trim() };
      }),
    [nodes, dropTargetId, highlightedCardIds],
  );

  // Live drop-target highlight: while a card is dragged, mark the card it would
  // nest into so the user sees the target before releasing. No commit happens
  // until drag stop — this is pure visual feedback over the existing behavior.
  const onNodeDrag = useCallback(
    (_event: MouseEvent | TouchEvent, node: MapFlowNode) => {
      if (node.type !== "thought") return;
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
    (_event: MouseEvent | TouchEvent, node: MapFlowNode) => {
      if (node.type !== "thought") return;
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
      const originId = connectingFrom.current?.nodeId;
      const sourceId =
        originId && (originId === connection.source || originId === connection.target)
          ? originId
          : connection.source;
      const targetId = sourceId === connection.source ? connection.target : connection.source;
      if (sourceId === targetId) return;
      const source = store.get(sourceId);
      const target = store.get(targetId);
      if (!source || !target) return;
      if (source.role === "connection_label" || target.role === "connection_label") return;
      const sourceHandleId =
        sourceId === connection.source
          ? anchorHandleId(connection.sourceHandle)
          : anchorHandleId(connection.targetHandle);
      const targetHandleId =
        targetId === connection.target
          ? anchorHandleId(connection.targetHandle)
          : anchorHandleId(connection.sourceHandle);
      if (!requireConnectionLabel) {
        onBeforeMapChange();
        store.registerConnection({
          sourceId,
          targetId,
          text: "",
          bank,
          sourceHandleId,
          targetHandleId,
          layoutDirection: "source_to_target",
          position: connectionMidpoint(store, sourceId, targetId),
        });
        onStoreChange();
        return;
      }
      setPendingConnection({
        sourceId,
        targetId,
        sourceHandleId,
        targetHandleId,
        text: "",
        layoutDirection: "source_to_target",
      });
      setConnectionPanelKey((key) => key + 1);
    },
    [bank, onBeforeMapChange, onStoreChange, requireConnectionLabel, store],
  );

  // Dragging a connector from a card and releasing on the empty canvas spawns a
  // new card there and connects the two — an explicit, user-driven map action.
  const connectingFrom = useRef<
    { nodeId: string; handleType: "source" | "target" | null; handleId: string | null } | null
  >(null);

  const onConnectStart = useCallback<OnConnectStart>((_event, params) => {
    connectingFrom.current = params.nodeId
      ? { nodeId: params.nodeId, handleType: params.handleType, handleId: params.handleId }
      : null;
  }, []);

  // Best-effort: focus a freshly created card so the user can type into it.
  const focusNewCard = useCallback((id: string) => {
    window.setTimeout(() => {
      const el = document.querySelector(
        `.react-flow__node[data-id="${id}"] textarea`,
      ) as HTMLTextAreaElement | null;
      el?.focus();
    }, 0);
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const from = connectingFrom.current;
      connectingFrom.current = null;
      if (!from) return;
      // A valid drop onto an existing card's handle is already handled by
      // onConnect — don't also spawn a card. Releasing on another existing card
      // (not a handle) must not create one either, so require the empty pane.
      if (connectionState?.isValid) return;
      const targetEl = event.target as Element | null;
      if (!targetEl?.classList.contains("react-flow__pane")) return;

      const origin = store.get(from.nodeId);
      if (!origin || origin.role === "connection_label") return;

      const point =
        "changedTouches" in event && event.changedTouches.length > 0
          ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
          : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      const pos = flow.screenToFlowPosition(point);
      const cardPosition = { x: pos.x - CARD_WIDTH / 2, y: pos.y - 16 };

      // Handles are geometric, not semantic: the card the user dragged from is
      // always the source of a newly drawn connector, even if they grabbed a
      // target-side handle.
      const originHandle = anchorHandleId(from.handleId);

      if (requireConnectionLabel) {
        // Defer card creation to confirm so Cancel leaves nothing behind and the
        // whole action (card + connection) is one undo step.
        setPendingConnection({
          sourceId: origin.id,
          targetId: "",
          sourceHandleId: originHandle,
          targetHandleId: undefined,
          text: "",
          layoutDirection: "source_to_target",
          createCard: { position: cardPosition, side: "target" },
        });
        setConnectionPanelKey((key) => key + 1);
        return;
      }

      // "Label off": create + connect immediately as a single undoable action.
      onBeforeMapChange();
      const newCard = store.addBlankUserCard(cardPosition);
      const sourceId = origin.id;
      const targetId = newCard.id;
      store.registerConnection({
        sourceId,
        targetId,
        text: "",
        bank,
        sourceHandleId: originHandle,
        targetHandleId: undefined,
        layoutDirection: "source_to_target",
        position: connectionMidpoint(store, sourceId, targetId),
      });
      onStoreChange();
      focusNewCard(newCard.id);
    },
    [bank, flow, focusNewCard, onBeforeMapChange, onStoreChange, requireConnectionLabel, store],
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
  // to the bank (registerConnection handles that). For a deferred connector-to-
  // canvas card, the new card is created here so card + connection are one action.
  const confirmConnection = useCallback(() => {
    if (!pendingConnection) return;
    const pc = pendingConnection;
    // Validate the endpoint(s) that must already exist BEFORE mutating anything,
    // so a bail (e.g. the origin card was deleted while labeling) can't leave a
    // half-created connection or an orphan card.
    const existingSideId = pc.createCard
      ? pc.createCard.side === "source"
        ? pc.targetId
        : pc.sourceId
      : undefined;
    if (existingSideId !== undefined) {
      const existing = store.get(existingSideId);
      if (!existing || existing.role === "connection_label") {
        setPendingConnection(null);
        return;
      }
    } else {
      const source = store.get(pc.sourceId);
      const target = store.get(pc.targetId);
      if (!source || !target || source.role === "connection_label" || target.role === "connection_label") {
        setPendingConnection(null);
        return;
      }
    }

    onBeforeMapChange();
    let sourceId = pc.sourceId;
    let targetId = pc.targetId;
    let createdCardId: string | undefined;
    if (pc.createCard) {
      const newCard = store.addBlankUserCard(pc.createCard.position);
      createdCardId = newCard.id;
      if (pc.createCard.side === "source") sourceId = newCard.id;
      else targetId = newCard.id;
    }
    store.registerConnection({
      sourceId,
      targetId,
      text: pc.text,
      bank,
      sourceHandleId: pc.sourceHandleId,
      targetHandleId: pc.targetHandleId,
      layoutDirection: pc.layoutDirection,
      position: connectionMidpoint(store, sourceId, targetId),
    });
    setPendingConnection(null);
    onStoreChange();
    if (createdCardId) focusNewCard(createdCardId);
  }, [bank, focusNewCard, onBeforeMapChange, onStoreChange, pendingConnection, store]);

  const sourceUnit = pendingConnection ? store.get(pendingConnection.sourceId) : undefined;
  const targetUnit = pendingConnection ? store.get(pendingConnection.targetId) : undefined;
  const sourceLabelText =
    sourceUnit?.text ?? (pendingConnection?.createCard?.side === "source" ? "new card" : "source");
  const targetLabelText =
    targetUnit?.text ?? (pendingConnection?.createCard?.side === "target" ? "new card" : "target");

  return (
    <section className="map-panel">
      <div className={`map-header ${draftDockActive ? "draft-dock-target" : ""}`}>
        <div className="map-heading">
          <span className="map-count">{visibleCardCount} cards</span>
        </div>

        <div className="map-left-tools">
          {draftDockSlot ?? draftDock}
          <button type="button" className="map-clear-draft" onClick={onClearDraft} title="Clear the draft only">
            Clear draft
          </button>
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
        </div>

        <div className="map-right-tools">
          <button type="button" className="map-clean" onClick={autoClean} title="Tidy the map: lay connected cards into clean trees and spread the rest across the canvas">
            Auto-clean
          </button>

          <button type="button" className="map-clear-map" onClick={onClearMap} title="Clear the map only">
            Clear map
          </button>

          <button type="button" className="map-undo" onClick={onUndo} disabled={!canUndo} title="Undo map change">
            Undo
          </button>

          {commandAck && (
            <div className="map-command-ack" role="status">
              <span>{commandAck.text}</span>
              <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo this map command">
                Undo
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="map-hint">
        Drag a card onto another to nest it inside · use "Out" to separate ·
        drag a card dot to connect · drag a line end to move a connector
      </p>

      <div className="map-canvas" ref={canvasRef}>
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
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
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
              <span>{sourceLabelText}</span>
              <span>to</span>
              <span>{targetLabelText}</span>
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

      </div>
    </section>
  );
}
