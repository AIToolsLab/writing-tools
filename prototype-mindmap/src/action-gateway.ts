import { containsWholePhrase, normalize } from "./normalize";
import type { ConnectionLayoutDirection, ThoughtUnitStore, ThoughtUnitStoreSnapshot, XYPosition, XYSize } from "./map-store";
import type { SourceBank } from "./store";
import type { ConfirmedReflection, ThoughtUnit, ThoughtUnitRole } from "./types";
import type { ContributionOrigin } from "./assistance-contract";

export type GatewayActor = "ai_proposal" | "user_canvas";
export type ProposedActionKind = "create_card" | "edit_card" | "nest_card" | "connect_cards";

export interface ProposedRef {
  id?: string;
  text?: string;
  sourceUtteranceIds?: string[];
}
export interface RelationEvidence { utteranceId: string; text: string; }
export type PairingProofKind = "co_mentioned" | "selection_pair" | "selection_and_named_card";
export interface PairingProofCandidate { kind: Exclude<PairingProofKind, "selection_pair">; utteranceId: string; }
export interface RelationshipLabelOption { text: string; sourceUtteranceIds?: string[]; }
/** Historical proof captured at proposal creation, never re-derived at confirmation. */
export interface VerifiedPairingProof { kind: PairingProofKind; endpointIds: [string, string]; utteranceId?: string; selectedCardIds?: string[]; }

export type ProposedAction =
  | { kind: "create_card"; text: string; sourceUtteranceIds: string[] }
  | { kind: "edit_card"; id: string; text: string; sourceUtteranceIds: string[] }
  | { kind: "nest_card"; child: ProposedRef; parent: ProposedRef; relationEvidence?: RelationEvidence }
  | { kind: "connect_cards"; source: ProposedRef; target: ProposedRef; labelText?: string; labelSourceUtteranceIds?: string[]; labelOrigin?: ContributionOrigin; labelOptions?: RelationshipLabelOption[]; relationEvidence?: RelationEvidence; pairingProof?: PairingProofCandidate };

export type ExecutableRef = { id: string } | { text: string; sourceUtteranceIds: string[] };
export type ExecutableAction =
  | { kind: "create_card"; text: string; sourceUtteranceIds: string[] }
  | { kind: "edit_card"; id: string; text: string; sourceUtteranceIds: string[] }
  | { kind: "nest_card"; child: ExecutableRef; parentId: string }
  | { kind: "connect_cards"; source: ExecutableRef; target: ExecutableRef; labelText?: string; labelSourceUtteranceIds?: string[]; labelOrigin?: ContributionOrigin };

export type GatewayReason =
  | "missing_text"
  | "non_verbatim_text"
  | "unknown_card"
  | "ambiguous_card"
  | "missing_label"
  | "self_reference"
  | "nest_cycle"
  | "duplicate_connection"
  | "nested_endpoint"
  | "ungrounded_relationship";

export type GatewayResult =
  | { status: "ready"; action: ExecutableAction; referencedCardIds: string[]; origin?: ContributionOrigin; pairingProof?: VerifiedPairingProof }
  | { status: "needs_input"; fields: Array<"child" | "parent" | "source" | "target" | "label" | "text">; detail: string; origin?: "unresolved" }
  | { status: "needs_reference_choice"; slot: "child" | "parent" | "source" | "target"; candidates: Array<{ id: string; text: string }>; detail: string }
  | { status: "needs_relationship_label"; action: Extract<ExecutableAction, { kind: "connect_cards" }>; referencedCardIds: string[]; pairingProof?: VerifiedPairingProof; pairingOrigin: ContributionOrigin; options: Array<RelationshipLabelOption & { origin: ContributionOrigin }>; detail: string }
  | { status: "rejected"; reason: GatewayReason; detail: string };

export interface GatewayContext {
  actor: GatewayActor;
  store: ThoughtUnitStore;
  bank: Pick<SourceBank, "get" | "getAll">;
  requireConnectionLabel?: boolean;
  allowAiSuggestedStructure?: boolean;
  allowGroundedOptions?: boolean;
  turnUtteranceIds?: string[];
  selectedCardIds?: string[];
  verifiedPairingProof?: VerifiedPairingProof;
}

/** Explicit direct-manipulation intents. These never travel through the model. */
export type CanvasAction =
  | { kind: "restore_snapshot"; snapshot: ThoughtUnitStoreSnapshot }
  | { kind: "create_blank_card"; position?: XYPosition }
  | { kind: "edit_card"; id: string; text: string }
  | { kind: "delete_card"; id: string }
  | { kind: "set_parent"; id: string; parentId?: string; role?: ThoughtUnitRole }
  | { kind: "set_role"; id: string; role: ThoughtUnitRole }
  | { kind: "swap_title"; id: string }
  | { kind: "move_card"; id: string; position: XYPosition }
  | { kind: "resize_card"; id: string; size: XYSize }
  | { kind: "connect_cards_direct"; sourceId: string; targetId: string; text: string; sourceHandleId?: string | null; targetHandleId?: string | null; layoutDirection?: ConnectionLayoutDirection; position?: XYPosition }
  | { kind: "delete_connection"; id: string }
  | { kind: "reconnect"; id: string; sourceId: string; targetId: string; sourceHandleId?: string; targetHandleId?: string }
  | { kind: "set_connection_direction"; id: string; layoutDirection: ConnectionLayoutDirection }
  | { kind: "set_connection_handles"; id: string; sourceHandleId?: string; targetHandleId?: string };

export type CanvasGatewayResult =
  | { status: "applied"; cardId?: string; connectionId?: string }
  | { status: "rejected"; reason: GatewayReason; detail: string };

/** Sole execution point for immediate, explicitly user-authored canvas actions. */
export function executeCanvasAction(action: CanvasAction, context: { store: ThoughtUnitStore; bank: SourceBank }): CanvasGatewayResult {
  const { store, bank } = context;
  if (action.kind === "restore_snapshot") { store.loadSnapshot(action.snapshot); return { status: "applied" }; }
  const card = "id" in action ? store.get(action.id) : undefined;
  if (["edit_card", "delete_card", "set_parent", "set_role", "swap_title", "move_card", "resize_card"].includes(action.kind) && (!card || card.role === "connection_label")) {
    return { status: "rejected", reason: "unknown_card", detail: "Card no longer exists." };
  }
  if (action.kind === "create_blank_card") return { status: "applied", cardId: store.addBlankUserCard(action.position).id };
  if (action.kind === "edit_card") { store.editText(action.id, action.text, bank); return { status: "applied", cardId: action.id }; }
  if (action.kind === "delete_card") { store.delete(action.id); return { status: "applied" }; }
  if (action.kind === "set_role") { store.setRole(action.id, action.role); return { status: "applied", cardId: action.id }; }
  if (action.kind === "swap_title") return store.swapTitle(action.id) ? { status: "applied", cardId: action.id } : { status: "rejected", reason: "unknown_card", detail: "Only a nested card can become the title." };
  if (action.kind === "set_parent") {
    if (action.parentId && (!store.get(action.parentId) || store.wouldCycle(action.id, action.parentId))) return { status: "rejected", reason: action.parentId && store.wouldCycle(action.id, action.parentId) ? "nest_cycle" : "unknown_card", detail: "That parent is unavailable or would create a cycle." };
    return store.setParent(action.id, action.parentId, action.role) ? { status: "applied", cardId: action.id } : { status: "rejected", reason: "nest_cycle", detail: "Nesting was rejected." };
  }
  if (action.kind === "move_card") { store.setPosition(action.id, action.position); return { status: "applied", cardId: action.id }; }
  if (action.kind === "resize_card") { store.setSize(action.id, action.size); return { status: "applied", cardId: action.id }; }
  if (action.kind === "delete_connection") { if (!store.getConnections().some((connection) => connection.id === action.id)) return { status: "rejected", reason: "unknown_card", detail: "Connection no longer exists." }; store.deleteConnection(action.id); return { status: "applied" }; }
  if (action.kind === "set_connection_direction") { if (!store.getConnections().some((connection) => connection.id === action.id)) return { status: "rejected", reason: "unknown_card", detail: "Connection no longer exists." }; store.setConnectionLayoutDirection(action.id, action.layoutDirection); return { status: "applied", connectionId: action.id }; }
  if (action.kind === "set_connection_handles") { if (!store.getConnections().some((connection) => connection.id === action.id)) return { status: "rejected", reason: "unknown_card", detail: "Connection no longer exists." }; store.setConnectionHandles(action.id, action.sourceHandleId, action.targetHandleId); return { status: "applied", connectionId: action.id }; }
  const source = store.get(action.sourceId); const target = store.get(action.targetId);
  if (!source || !target || source.role === "connection_label" || target.role === "connection_label") return { status: "rejected", reason: "unknown_card", detail: "Choose two existing cards." };
  if (action.sourceId === action.targetId) return { status: "rejected", reason: "self_reference", detail: "Choose two different cards." };
  if (action.kind === "reconnect") { if (!store.getConnections().some((connection) => connection.id === action.id)) return { status: "rejected", reason: "unknown_card", detail: "Connection no longer exists." }; store.reconnect(action.id, action.sourceId, action.targetId, action.sourceHandleId, action.targetHandleId); return { status: "applied", connectionId: action.id }; }
  const duplicate = store.getConnections().some((connection) => (connection.sourceId === action.sourceId && connection.targetId === action.targetId) || (connection.sourceId === action.targetId && connection.targetId === action.sourceId));
  if (duplicate) return { status: "rejected", reason: "duplicate_connection", detail: "Those cards are already connected." };
  const registered = store.registerConnection({ sourceId: action.sourceId, targetId: action.targetId, text: action.text, bank, sourceHandleId: action.sourceHandleId, targetHandleId: action.targetHandleId, layoutDirection: action.layoutDirection, position: action.position });
  return registered ? { status: "applied", connectionId: registered.connection.id } : { status: "rejected", reason: "nested_endpoint", detail: "Connection endpoints must resolve to different root cards." };
}

function verbatim(text: string, ids: string[] | undefined, bank: Pick<SourceBank, "get">): boolean {
  if (!text.trim() || !ids?.length) return false;
  return ids.some((id) => containsWholePhrase(bank.get(id)?.text ?? "", text));
}

function exactCard(text: string, units: ThoughtUnit[]): ThoughtUnit | undefined {
  const wanted = normalize(text);
  return units.find((unit) => unit.role !== "connection_label" && normalize(unit.text) === wanted);
}

function nearCards(text: string, units: ThoughtUnit[]): ThoughtUnit[] {
  const wanted = normalize(text);
  if (!wanted) return [];
  return units.filter((unit) => {
    if (unit.role === "connection_label") return false;
    const current = normalize(unit.text);
    return current !== wanted && (current.includes(wanted) || wanted.includes(current));
  });
}

function resolveRef(
  ref: ProposedRef,
  slot: "child" | "parent" | "source" | "target",
  context: GatewayContext,
): GatewayResult | { status: "resolved"; ref: ExecutableRef; ids: string[] } {
  const units = context.store.getAll();
  if (ref.id) {
    const card = context.store.get(ref.id);
    if (!card || card.role === "connection_label") {
      return { status: "rejected", reason: "unknown_card", detail: `${slot} card no longer exists.` };
    }
    return { status: "resolved", ref: { id: card.id }, ids: [card.id] };
  }
  const text = ref.text?.trim();
  const choices = (items: ThoughtUnit[]) => items.filter((unit) => !unit.parentId && unit.role !== "connection_label").map((unit) => ({ id: unit.id, text: unit.text }));
  if (!text) return { status: "needs_reference_choice", slot, candidates: choices(units), detail: `Choose the ${slot} card.` };
  const exact = exactCard(text, units);
  if (exact) return { status: "resolved", ref: { id: exact.id }, ids: [exact.id] };
  const near = nearCards(text, units);
  if (near.length > 0) return { status: "needs_reference_choice", slot, candidates: choices(near), detail: `Choose the matching ${slot} card.` };
  if (near.length > 1) return { status: "needs_input", fields: [slot], detail: `Choose which card matches “${text}”.` };
  if (near.length === 1) return { status: "needs_input", fields: [slot], detail: `Confirm the matching card for “${text}”.` };
  if (context.actor === "ai_proposal" && !verbatim(text, ref.sourceUtteranceIds, context.bank)) {
    return { status: "rejected", reason: "non_verbatim_text", detail: `${slot} wording is not a user-verbatim span.` };
  }
  return { status: "resolved", ref: { text, sourceUtteranceIds: ref.sourceUtteranceIds ?? [] }, ids: [] };
}

function pairingProof(
  sourceId: string | undefined,
  targetId: string | undefined,
  action: Extract<ProposedAction, { kind: "connect_cards" }>,
  context: GatewayContext,
): VerifiedPairingProof | undefined {
  if (!sourceId || !targetId) return undefined;
  if (context.verifiedPairingProof
    && context.verifiedPairingProof.endpointIds.includes(sourceId)
    && context.verifiedPairingProof.endpointIds.includes(targetId)) return context.verifiedPairingProof;
  const selected = context.selectedCardIds ?? [];
  const endpoints: [string, string] = [sourceId, targetId];
  if (selected.length === 2 && selected.includes(sourceId) && selected.includes(targetId)) {
    return { kind: "selection_pair", endpointIds: endpoints, selectedCardIds: [...selected] };
  }
  const candidate = action.pairingProof ?? (action.relationEvidence ? { kind: "co_mentioned" as const, utteranceId: action.relationEvidence.utteranceId } : undefined);
  if (!candidate || !context.turnUtteranceIds?.includes(candidate.utteranceId)) return undefined;
  const utterance = context.bank.get(candidate.utteranceId)?.text ?? "";
  const sourceText = context.store.get(sourceId)?.text;
  const targetText = context.store.get(targetId)?.text;
  if (!sourceText || !targetText) return undefined;
  if (candidate.kind === "co_mentioned" && containsWholePhrase(utterance, sourceText) && containsWholePhrase(utterance, targetText)) {
    return { kind: "co_mentioned", endpointIds: endpoints, utteranceId: candidate.utteranceId };
  }
  if (candidate.kind === "selection_and_named_card" && selected.length === 1 && (selected[0] === sourceId || selected[0] === targetId)) {
    const named = selected[0] === sourceId ? targetText : sourceText;
    if (containsWholePhrase(utterance, named)) return { kind: "selection_and_named_card", endpointIds: endpoints, utteranceId: candidate.utteranceId, selectedCardIds: [...selected] };
  }
  return undefined;
}

export function inspectAction(action: ProposedAction, context: GatewayContext): GatewayResult {
  const ai = context.actor === "ai_proposal";
  const suggested = context.allowAiSuggestedStructure === true;
  if (action.kind === "create_card") {
    if (!action.text.trim()) return { status: "needs_input", fields: ["text"], detail: "Enter card wording." };
    const asserted = verbatim(action.text, action.sourceUtteranceIds, context.bank);
    if (ai && !suggested && !asserted) {
      return { status: "rejected", reason: "non_verbatim_text", detail: "Card wording is not a user-verbatim span." };
    }
    return { status: "ready", action, referencedCardIds: [], origin: ai && !asserted ? "ai_suggested" : "user_asserted" };
  }
  if (action.kind === "edit_card") {
    if (!context.store.get(action.id)) return { status: "rejected", reason: "unknown_card", detail: "Card no longer exists." };
    if (!action.text.trim()) return { status: "needs_input", fields: ["text"], detail: "Enter card wording." };
    const asserted = verbatim(action.text, action.sourceUtteranceIds, context.bank);
    if (ai && !suggested && !asserted) {
      return { status: "rejected", reason: "non_verbatim_text", detail: "Card wording is not a user-verbatim span." };
    }
    return { status: "ready", action, referencedCardIds: [action.id], origin: ai && !asserted ? "ai_suggested" : "user_asserted" };
  }
  const firstSlot = action.kind === "nest_card" ? "child" : "source";
  const secondSlot = action.kind === "nest_card" ? "parent" : "target";
  const first = resolveRef(action.kind === "nest_card" ? action.child : action.source, firstSlot, context);
  if (first.status !== "resolved") return first;
  const second = resolveRef(action.kind === "nest_card" ? action.parent : action.target, secondSlot, context);
  if (second.status !== "resolved") return second;
  const ids = [...first.ids, ...second.ids];
  const firstId = "id" in first.ref ? first.ref.id : undefined;
  const secondId = "id" in second.ref ? second.ref.id : undefined;
  if (firstId && secondId && firstId === secondId) {
    return { status: "rejected", reason: "self_reference", detail: "Choose two different cards." };
  }
  if (action.kind === "nest_card") {
    if (!("id" in second.ref)) return { status: "needs_input", fields: ["parent"], detail: "Choose an existing parent card." };
    if (firstId && context.store.wouldCycle(firstId, second.ref.id)) {
      return { status: "rejected", reason: "nest_cycle", detail: "That nesting would create a cycle." };
    }
    const relation = relationshipIsAsserted(first.ref, second.ref, action.relationEvidence, context);
    if (ai && !relation && !suggested) return { status: "rejected", reason: "ungrounded_relationship", detail: "Nesting needs relationship evidence from one user utterance." };
    return { status: "ready", action: { kind: "nest_card", child: first.ref, parentId: second.ref.id }, referencedCardIds: ids, origin: ai && !relation ? "ai_suggested" : "user_asserted" };
  }
  const proof = pairingProof(firstId, secondId, action, context);
  // At L0/L1, the model cannot choose a pair and hand the user a presupposing
  // completion card. The pair must already be established by this turn.
  if (ai && !suggested && !proof) return { status: "rejected", reason: "ungrounded_relationship", detail: "A connection needs verified user pairing evidence." };
  const optionOrigins = (action.labelOptions ?? []).map((option) => ({ ...option, origin: verbatim(option.text, option.sourceUtteranceIds, context.bank) ? "user_asserted" as const : "ai_suggested" as const }));
  if (optionOrigins.length && !context.allowGroundedOptions && !suggested) return { status: "rejected", reason: "non_verbatim_text", detail: "Relationship options are not available under this contract." };
  if (!suggested && optionOrigins.some((option) => option.origin !== "user_asserted")) return { status: "rejected", reason: "non_verbatim_text", detail: "Relationship options must use exact user wording." };
  const executable: Extract<ExecutableAction, { kind: "connect_cards" }> = { kind: "connect_cards", source: first.ref, target: second.ref, labelText: action.labelText, labelSourceUtteranceIds: action.labelSourceUtteranceIds, labelOrigin: action.labelOrigin };
  if (!action.labelText?.trim() && (ai || context.requireConnectionLabel)) {
    return { status: "needs_relationship_label", action: executable, referencedCardIds: ids, pairingProof: proof, pairingOrigin: ai && !proof ? "ai_suggested" : "user_asserted", options: optionOrigins, detail: "Enter the relationship wording." };
  }
  if (ai && action.labelText && !suggested && !verbatim(action.labelText, action.labelSourceUtteranceIds, context.bank)) {
    return { status: "rejected", reason: "non_verbatim_text", detail: "Relationship wording is not a user-verbatim span." };
  }
  if (firstId && secondId) {
    const duplicate = context.store.getConnections().some((connection) =>
      (connection.sourceId === firstId && connection.targetId === secondId) ||
      (connection.sourceId === secondId && connection.targetId === firstId),
    );
    if (duplicate) return { status: "rejected", reason: "duplicate_connection", detail: "Those cards are already connected." };
  }
  const relation = relationshipIsAsserted(first.ref, second.ref, action.relationEvidence, context);
  if (ai && !relation && !suggested) return { status: "rejected", reason: "ungrounded_relationship", detail: "A connection needs relationship evidence from one user utterance." };
  return {
    status: "ready",
    action: executable,
    referencedCardIds: ids,
    origin: ai && (!relation || (Boolean(action.labelText?.trim()) && !verbatim(action.labelText!, action.labelSourceUtteranceIds, context.bank))) ? "ai_suggested" : "user_asserted",
    pairingProof: proof,
  };
}

function referenceText(ref: ExecutableRef, store: ThoughtUnitStore): string | undefined {
  return "id" in ref ? store.get(ref.id)?.text : ref.text;
}

function relationshipIsAsserted(first: ExecutableRef, second: ExecutableRef, evidence: RelationEvidence | undefined, context: GatewayContext): boolean {
  if (!evidence?.text.trim()) return false;
  const firstText = referenceText(first, context.store);
  const secondText = referenceText(second, context.store);
  const utterance = context.bank.get(evidence.utteranceId)?.text ?? "";
  return Boolean(firstText && secondText
    && containsWholePhrase(utterance, firstText)
    && containsWholePhrase(utterance, secondText)
    && containsWholePhrase(utterance, evidence.text));
}

function ensureExecutableCard(
  ref: ExecutableRef,
  store: ThoughtUnitStore,
  bank: SourceBank,
  provenance?: { origin: ContributionOrigin; contract?: import("./assistance-contract").AssistanceContractSnapshot; relationshipProvenance?: { pairingOrigin: ContributionOrigin; labelOrigin: ContributionOrigin } },
): ThoughtUnit | undefined {
  if ("id" in ref) return store.get(ref.id);
  const existing = store.getAll().find((unit) => unit.role !== "connection_label" && normalize(unit.text) === normalize(ref.text));
  if (existing) return existing;
  if (provenance?.origin === "ai_suggested") return store.addAiSuggestedCard(ref.text, provenance.contract);
  const utterance = bank.add(ref.text, "declaration");
  bank.markCommandOnly([utterance.id]);
  const unit = store.addFromUserUtterance(utterance);
  return store.update(unit.id, { source: { ...unit.source, utteranceIds: Array.from(new Set([...ref.sourceUtteranceIds, utterance.id])) } }) ?? unit;
}

/** Apply only an executable action returned by inspectAction. */
export function applyGatewayActions(
  actions: ExecutableAction[],
  store: ThoughtUnitStore,
  bank: SourceBank,
  provenance?: { origin: ContributionOrigin; contract?: import("./assistance-contract").AssistanceContractSnapshot; relationshipProvenance?: { pairingOrigin: ContributionOrigin; labelOrigin: ContributionOrigin } },
): ThoughtUnit[] {
  const changed: ThoughtUnit[] = [];
  for (const action of actions) {
    if (action.kind === "create_card") {
      const unit = ensureExecutableCard({ text: action.text, sourceUtteranceIds: action.sourceUtteranceIds }, store, bank, provenance);
      if (unit) changed.push(provenance ? (store.update(unit.id, { source: { ...unit.source, ...provenance } }) ?? unit) : unit);
    } else if (action.kind === "edit_card") {
      if (provenance?.origin === "ai_suggested") {
        const edited = store.editAiSuggestedText(action.id, action.text, provenance.contract);
        if (edited) changed.push(edited);
      } else {
        const utterance = store.editText(action.id, action.text, bank); const edited = store.get(action.id);
        if (utterance && edited) changed.push(store.update(action.id, { source: { ...edited.source, utteranceIds: Array.from(new Set([...edited.source.utteranceIds, ...action.sourceUtteranceIds, utterance.id])), ...provenance } }) ?? edited);
      }
    } else if (action.kind === "nest_card") {
      const child = ensureExecutableCard(action.child, store, bank, provenance);
      if (child && store.get(action.parentId)) {
        const nested = store.setParent(child.id, action.parentId, store.getAll().some((unit) => unit.parentId === child.id) ? "subnode" : "content");
        if (nested) changed.push(provenance ? (store.update(nested.id, { parentProvenance: provenance }) ?? nested) : nested);
      }
    } else {
      const source = ensureExecutableCard(action.source, store, bank, provenance); const target = ensureExecutableCard(action.target, store, bank, provenance);
      if (!source || !target || source.id === target.id) continue;
      const registered = store.registerConnection({ sourceId: source.id, targetId: target.id, text: action.labelText ?? "", bank, layoutDirection: "source_to_target", provenance, relationshipProvenance: provenance?.relationshipProvenance, recordInSourceBank: provenance?.origin !== "ai_suggested" });
      if (registered) {
        const labelUtteranceIds = provenance?.origin === "ai_suggested"
          ? []
          : action.labelSourceUtteranceIds?.length
            ? Array.from(new Set([...action.labelSourceUtteranceIds, ...registered.labelUnit.source.utteranceIds]))
            : registered.labelUnit.source.utteranceIds;
        const label = store.update(registered.labelUnit.id, { source: { ...registered.labelUnit.source, utteranceIds: labelUtteranceIds, ...provenance } }) ?? registered.labelUnit;
        changed.push(label);
      }
    }
  }
  return changed;
}

/** Consequence boundary for a code-validated reflection after the user's click. */
export function applyConfirmedReflection(reflection: ConfirmedReflection, store: ThoughtUnitStore): CanvasGatewayResult {
  const unit = store.addFromReflection(reflection);
  return { status: "applied", cardId: unit.id };
}
