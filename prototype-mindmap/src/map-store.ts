import type { LLMMapContext, LLMMapConnection } from "./llm-contract";
import { nextId, primeIdCounters } from "./store";
import type { SourceBank } from "./store";
import type {
  ConfirmedReflection,
  SourceUtterance,
  ThoughtUnit,
  ThoughtUnitRole,
} from "./types";

export interface XYPosition {
  x: number;
  y: number;
}

export interface ThoughtConnection {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandleId?: string;
  targetHandleId?: string;
  labelUnitId: string;
  /** Undefined when the connection has no wording (relationship label is optional). */
  labelUtteranceId?: string;
  confirmedAt: number;
  createdBy: "user";
}

export interface RegisteredConnection {
  connection: ThoughtConnection;
  labelUnit: ThoughtUnit;
  /** Undefined when no wording was provided. */
  utterance?: SourceUtterance;
}

export interface ThoughtUnitStoreSnapshot {
  units: ThoughtUnit[];
  positions: Record<string, XYPosition>;
  connections: ThoughtConnection[];
}

function roleEntry(role: ThoughtUnitRole, changedBy: "user" | "ai_proposed_user_confirmed") {
  return { role, changedBy, at: Date.now() };
}

function defaultPosition(index: number): XYPosition {
  return {
    x: 80 + (index % 4) * 280,
    y: 80 + Math.floor(index / 4) * 180,
  };
}

export class ThoughtUnitStore {
  private _units: Map<string, ThoughtUnit> = new Map();
  private _positions: Map<string, XYPosition> = new Map();
  private _connections: Map<string, ThoughtConnection> = new Map();

  add(unit: ThoughtUnit, position: XYPosition = defaultPosition(this._units.size)): ThoughtUnit {
    this._units.set(unit.id, unit);
    this._positions.set(unit.id, position);
    return unit;
  }

  addFromReflection(
    reflection: ConfirmedReflection,
    position: XYPosition = defaultPosition(this._units.size),
  ): ThoughtUnit {
    const existing = this.getByReflectionId(reflection.id);
    if (existing) return existing;

    const unit: ThoughtUnit = {
      id: nextId("tu"),
      text: reflection.text,
      role: "node",
      source: {
        reflectionId: reflection.id,
        utteranceIds: [...reflection.sourceUtteranceIds],
        createdBy: "ai_from_reflection",
      },
      roleHistory: [roleEntry("node", "ai_proposed_user_confirmed")],
    };
    return this.add(unit, position);
  }

  addFromUserUtterance(
    utterance: SourceUtterance,
    position: XYPosition = defaultPosition(this._units.size),
  ): ThoughtUnit {
    const existing = this.getByUtteranceId(utterance.id);
    if (existing) return existing;

    const unit: ThoughtUnit = {
      id: nextId("tu"),
      text: utterance.text,
      role: "node",
      source: {
        utteranceIds: [utterance.id],
        createdBy: "user",
      },
      roleHistory: [roleEntry("node", "user")],
    };
    return this.add(unit, position);
  }

  /**
   * Create a blank, user-authored standalone card. The user explicitly making a
   * card is user-authored structure (allowed). It carries no bank utterance yet;
   * grounding is added when the user types text and `editText` runs.
   */
  addBlankUserCard(position?: XYPosition): ThoughtUnit {
    const unit: ThoughtUnit = {
      id: nextId("tu"),
      text: "",
      role: "node",
      source: {
        utteranceIds: [],
        createdBy: "user",
      },
      roleHistory: [roleEntry("node", "user")],
    };
    return this.add(unit, position ?? defaultPosition(this._units.size));
  }

  get(id: string): ThoughtUnit | undefined {
    return this._units.get(id);
  }

  getByReflectionId(reflectionId: string): ThoughtUnit | undefined {
    return this.getAll().find((u) => u.source.reflectionId === reflectionId);
  }

  getByUtteranceId(utteranceId: string): ThoughtUnit | undefined {
    return this.getAll().find((u) => u.source.utteranceIds.includes(utteranceId));
  }

  getAll(): ThoughtUnit[] {
    return Array.from(this._units.values());
  }

  update(id: string, patch: Partial<Omit<ThoughtUnit, "id">>): ThoughtUnit | undefined {
    const current = this._units.get(id);
    if (!current) return undefined;
    const updated: ThoughtUnit = {
      ...current,
      ...patch,
      source: patch.source ?? current.source,
      roleHistory: patch.roleHistory ?? current.roleHistory,
    };
    this._units.set(id, updated);
    return updated;
  }

  delete(id: string): void {
    this._units.delete(id);
    this._positions.delete(id);

    for (const unit of this.getAll()) {
      if (unit.parentId === id) {
        this.setParent(unit.id, undefined, "node");
      }
    }

    for (const connection of this.getConnections()) {
      if (
        connection.sourceId === id ||
        connection.targetId === id ||
        connection.labelUnitId === id
      ) {
        this._connections.delete(connection.id);
      }
    }
  }

  setRole(
    id: string,
    role: ThoughtUnitRole,
    changedBy: "user" | "ai_proposed_user_confirmed" = "user",
  ): ThoughtUnit | undefined {
    const current = this._units.get(id);
    if (!current) return undefined;
    const next: ThoughtUnit = {
      ...current,
      role,
      roleHistory: [...current.roleHistory, roleEntry(role, changedBy)],
    };
    this._units.set(id, next);
    return next;
  }

  /**
   * Would parenting `childId` under `parentId` create a cycle? True if the
   * proposed parent IS the child or already descends from it.
   */
  wouldCycle(childId: string, parentId: string): boolean {
    return parentId === childId || this.isAncestorOf(childId, parentId);
  }

  /** Walk `nodeId`'s parent chain; is `ancestorId` somewhere above it? */
  private isAncestorOf(ancestorId: string, nodeId: string): boolean {
    const seen = new Set<string>();
    let current = this._units.get(nodeId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      if (seen.has(current.parentId)) break; // guard against a pre-existing cycle
      seen.add(current.parentId);
      current = this._units.get(current.parentId);
    }
    return false;
  }

  setParent(id: string, parentId?: string, role?: ThoughtUnitRole): ThoughtUnit | undefined {
    const current = this._units.get(id);
    if (!current) return undefined;
    // Never let a re-parent close a loop. No-op if it would.
    if (parentId && this.wouldCycle(id, parentId)) return undefined;
    const nextRole = role ?? (parentId ? current.role : "node");
    const next: ThoughtUnit = {
      ...current,
      role: nextRole,
      parentId,
      roleHistory: [...current.roleHistory, roleEntry(nextRole, "user")],
    };
    if (!parentId) delete next.parentId;
    this._units.set(id, next);
    return next;
  }

  swapTitle(memberId: string): boolean {
    const member = this._units.get(memberId);
    if (!member?.parentId) return false;

    const oldTitleId = member.parentId;
    const oldTitle = this._units.get(oldTitleId);
    if (!oldTitle) return false;

    const siblings = this.getAll().filter(
      (unit) => unit.parentId === oldTitleId && unit.id !== memberId,
    );

    this.setParent(memberId, undefined, "node");
    this.setParent(oldTitleId, memberId, "content");
    for (const sibling of siblings) {
      this.setParent(sibling.id, memberId, sibling.role);
    }
    return true;
  }

  editText(id: string, text: string, bank: SourceBank): SourceUtterance | undefined {
    const current = this._units.get(id);
    if (!current) return undefined;

    const utterance = bank.add(text, "node_edit");
    const utteranceIds = [...current.source.utteranceIds, utterance.id];
    this._units.set(id, {
      ...current,
      text,
      source: {
        ...current.source,
        utteranceIds,
      },
    });
    return utterance;
  }

  registerConnection({
    sourceId,
    targetId,
    text,
    bank,
    labelUtteranceId,
    sourceHandleId,
    targetHandleId,
    position,
  }: {
    sourceId: string;
    targetId: string;
    text: string;
    bank: SourceBank;
    labelUtteranceId?: string;
    sourceHandleId?: string | null;
    targetHandleId?: string | null;
    position?: XYPosition;
  }): RegisteredConnection {
    const trimmed = text.trim();
    // Wording is optional. Only write to the bank when there is actually wording.
    const utterance = trimmed
      ? labelUtteranceId
        ? bank.get(labelUtteranceId) ?? bank.add(trimmed, "declaration")
        : bank.add(trimmed, "declaration")
      : undefined;

    const labelUnit: ThoughtUnit = {
      id: nextId("tu"),
      text: trimmed,
      role: "connection_label",
      source: {
        utteranceIds: utterance ? [utterance.id] : [],
        createdBy: "user",
      },
      roleHistory: [roleEntry("connection_label", "user")],
    };
    this.add(labelUnit, position ?? defaultPosition(this._units.size));

    const connection: ThoughtConnection = {
      id: nextId("edge"),
      sourceId,
      targetId,
      sourceHandleId: sourceHandleId ?? undefined,
      targetHandleId: targetHandleId ?? undefined,
      labelUnitId: labelUnit.id,
      labelUtteranceId: utterance?.id,
      confirmedAt: Date.now(),
      createdBy: "user",
    };
    this._connections.set(connection.id, connection);
    return { connection, labelUnit, utterance };
  }

  /** Remove a connection and its (now-orphaned) label unit. */
  deleteConnection(id: string): void {
    const connection = this._connections.get(id);
    if (!connection) return;
    this._units.delete(connection.labelUnitId);
    this._positions.delete(connection.labelUnitId);
    this._connections.delete(id);
  }

  /** Move an existing connection's endpoint(s) to other cards. */
  reconnect(
    id: string,
    sourceId: string,
    targetId: string,
    sourceHandleId?: string | null,
    targetHandleId?: string | null,
  ): void {
    const connection = this._connections.get(id);
    if (!connection || sourceId === targetId) return;
    this._connections.set(id, {
      ...connection,
      sourceId,
      targetId,
      sourceHandleId: sourceHandleId ?? undefined,
      targetHandleId: targetHandleId ?? undefined,
    });
  }

  getConnections(): ThoughtConnection[] {
    return Array.from(this._connections.values());
  }

  setPosition(id: string, position: XYPosition): void {
    this._positions.set(id, position);
  }

  getPosition(id: string): XYPosition | undefined {
    return this._positions.get(id);
  }

  getPositions(): Record<string, XYPosition> {
    return Object.fromEntries(this._positions.entries());
  }

  snapshot(): ThoughtUnitStoreSnapshot {
    return {
      units: this.getAll(),
      positions: this.getPositions(),
      connections: this.getConnections(),
    };
  }

  loadSnapshot(snapshot: ThoughtUnitStoreSnapshot): void {
    this._units = new Map(snapshot.units.map((unit) => [unit.id, unit]));
    this._positions = new Map(Object.entries(snapshot.positions));
    this._connections = new Map(snapshot.connections.map((connection) => [connection.id, connection]));
    primeIdCounters(
      [
        ...snapshot.units.map((unit) => unit.id),
        ...snapshot.connections.map((connection) => connection.id),
      ],
    );
  }

  toLLMContext(): LLMMapContext {
    const connections: LLMMapConnection[] = this.getConnections().map((connection) => {
      const label = this.get(connection.labelUnitId);
      const source = this.get(connection.sourceId);
      const target = this.get(connection.targetId);
      return {
        id: connection.id,
        sourceId: connection.sourceId,
        targetId: connection.targetId,
        labelUnitId: connection.labelUnitId,
        labelText: label?.text ?? "",
        sourceText: source?.text ?? "",
        targetText: target?.text ?? "",
        utteranceIds:
          label?.source.utteranceIds ??
          (connection.labelUtteranceId ? [connection.labelUtteranceId] : []),
      };
    });

    return {
      thoughtUnits: this.getAll(),
      connections,
    };
  }
}
