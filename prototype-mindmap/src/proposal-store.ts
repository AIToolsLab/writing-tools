import type { ExecutableAction, ProposedAction, VerifiedPairingProof } from "./action-gateway";
import type { ClaimValidation, MirrorReflection } from "./types";
import type { AssistanceContractSnapshot, ContributionOrigin, InfluenceTrace } from "./assistance-contract";

export type ProposalState =
  | "shown"
  | "edited"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "invalidated";

/**
 * `unresolved` means the proposal is waiting for user-supplied completion;
 * it is intentionally distinct from an AI inference.
 */
/** @deprecated Use origin. Kept only for v3 persistence migration. */
export type ProposalAttribution = "asserted" | "inferred" | "unresolved";

export interface MapActionProposal {
  kind: "map_action";
  action: ProposedAction;
  /** Explicit lifecycle link; never inferred from action text. */
  candidateId?: string;
  executable?: ExecutableAction;
  /** Captured proof remains available for confirmation even after UI context is consumed. */
  pairingProof?: VerifiedPairingProof;
  completion?:
    | { kind: "relationship_label"; pairingProof?: VerifiedPairingProof; pairingOrigin: ContributionOrigin; options: Array<{ text: string; sourceUtteranceIds?: string[]; origin: ContributionOrigin }> }
    | { kind: "reference_choice"; slot: "child" | "parent" | "source" | "target"; candidates: Array<{ id: string; text: string }> }
    | { kind: "generic"; fields: Array<"child" | "parent" | "source" | "target" | "label" | "text"> };
}

export interface ReflectionProposal {
  kind: "reflection";
  reflection: MirrorReflection;
  claims: ClaimValidation[];
  decisions: Record<string, "pending" | "confirmed" | "declined">;
  editedTexts: Record<string, string>;
}

export interface Proposal {
  id: string;
  messageId?: number;
  mapRevision: number;
  referencedCardIds: string[];
  /** v3-compatible source, removed when the session is persisted as v4. */
  attribution?: ProposalAttribution;
  origin?: ContributionOrigin;
  influenceTrace?: InfluenceTrace;
  contract?: AssistanceContractSnapshot;
  state: ProposalState;
  detail: MapActionProposal | ReflectionProposal;
  invalidReason?: string;
}

export type ProposalStore = Map<string, Proposal>;

export function createProposalStore(items: Proposal[] = []): ProposalStore {
  return new Map(items.map((item) => [item.id, item]));
}

export function updateProposal(store: ProposalStore, id: string, patch: Partial<Proposal>): ProposalStore {
  const proposal = store.get(id);
  if (!proposal) return store;
  if (patch.state && !canTransitionProposal(proposal.state, patch.state)) return store;
  const next = new Map(store);
  next.set(id, { ...proposal, ...patch });
  return next;
}

export function canTransitionProposal(from: ProposalState, to: ProposalState): boolean {
  if (from === to) return true;
  if (from === "shown") return to === "edited" || to === "confirmed" || to === "declined" || to === "cancelled" || to === "invalidated";
  if (from === "edited") return to === "confirmed" || to === "declined" || to === "cancelled" || to === "invalidated";
  return false;
}

export function resolveProposal(
  store: ProposalStore,
  id: string,
  state: Extract<ProposalState, "confirmed" | "declined" | "cancelled" | "invalidated">,
  invalidReason?: string,
): ProposalStore {
  return updateProposal(store, id, { state, invalidReason });
}

export function activeProposals(store: ProposalStore): Proposal[] {
  return Array.from(store.values()).filter((proposal) =>
    proposal.state === "shown" || proposal.state === "edited",
  );
}
