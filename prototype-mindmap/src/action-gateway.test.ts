import { beforeEach, describe, expect, it } from "vitest";
import { applyConfirmedReflection, applyGatewayActions, executeCanvasAction, inspectAction } from "./action-gateway";
import { ThoughtUnitStore } from "./map-store";
import { cardRef, resetIdCounter, SourceBank } from "./store";

beforeEach(() => resetIdCounter());

function setup() {
  const bank = new SourceBank();
  const store = new ThoughtUnitStore();
  const first = bank.add("human control matters", "chat");
  const second = bank.add("transparency supports human control matters", "chat");
  const a = store.addFromUserUtterance(first);
  const b = store.addFromUserUtterance(second);
  return { bank, store, first, second, a, b };
}

describe("action gateway", () => {
  it("keeps an AI card proposal inert until the accepted action is applied", () => {
    const { bank, store, first } = setup();
    const result = inspectAction(
      { kind: "create_card", text: "human control", sourceUtteranceIds: [first.id] },
      { actor: "ai_proposal", store, bank },
    );
    expect(result.status).toBe("ready");
    expect(store.getAll()).toHaveLength(2);
    if (result.status !== "ready") return;
    applyGatewayActions([result.action], store, bank);
    expect(store.getAll().map((unit) => unit.text)).toContain("human control");
  });

  it("does not stage an AI proposal in cards, edges, or layout before confirmation", () => {
    const { bank, store, first } = setup();
    const before = store.snapshot();
    const result = inspectAction({ kind: "create_card", text: "human control", sourceUtteranceIds: [first.id] }, { actor: "ai_proposal", store, bank });
    expect(result.status).toBe("ready");
    expect(store.snapshot()).toEqual(before);
  });

  it("rejects AI-authored card wording that is not a verbatim user span", () => {
    const { bank, store, first } = setup();
    const result = inspectAction(
      { kind: "create_card", text: "central human control", sourceUtteranceIds: [first.id] },
      { actor: "ai_proposal", store, bank },
    );
    expect(result).toMatchObject({ status: "rejected", reason: "non_verbatim_text" });
  });

  it("allows non-verbatim material only at the suggestive gateway boundary and preserves its origin", () => {
    const { bank, store, first } = setup();
    const result = inspectAction(
      { kind: "create_card", text: "a lens of authorship", sourceUtteranceIds: [first.id] },
      { actor: "ai_proposal", store, bank, allowAiSuggestedStructure: true },
    );
    expect(result).toMatchObject({ status: "ready", origin: "ai_suggested" });
    if (result.status !== "ready") return;
    applyGatewayActions([result.action], store, bank, { origin: result.origin!, contract: { id: "suggestive_v1", version: 1, level: 2, label: "Suggestive", allowedResponseKinds: [], allowsAiSuggestedStructure: true, optionsMustBeVerbatim: true, mapWritePolicy: "user_confirmation_required", visualStagingPolicy: "no_unconfirmed_structure" } });
    expect(store.getAll().find((unit) => unit.text === "a lens of authorship")?.source.origin).toBe("ai_suggested");
    expect(bank.getAll().map((item) => item.text)).not.toContain("a lens of authorship");
  });

  it("keeps AI relationship wording out of the user bank and marks the edge", () => {
    const { bank, store, a, b, second } = setup();
    const before = bank.getAll().map((item) => item.text);
    const result = inspectAction(
      { kind: "connect_cards", source: { id: b.id }, target: { id: a.id }, labelText: "enables", relationEvidence: { utteranceId: second.id, text: "supports" } },
      { actor: "ai_proposal", store, bank, allowAiSuggestedStructure: true },
    );
    expect(result).toMatchObject({ status: "ready", origin: "ai_suggested" });
    if (result.status !== "ready") return;
    applyGatewayActions([result.action], store, bank, { origin: "ai_suggested" });
    expect(bank.getAll().map((item) => item.text)).toEqual(before);
    expect(store.getConnections()[0]).toMatchObject({ origin: "ai_suggested" });
    expect(store.get(store.getConnections()[0]!.labelUnitId)?.source).toMatchObject({ origin: "ai_suggested", utteranceIds: [] });
  });

  it("records AI-suggested nesting on the relationship without relabelling user card wording", () => {
    const { bank, store, a, b } = setup();
    const originalSource = b.source;
    const result = inspectAction(
      { kind: "nest_card", child: { id: b.id }, parent: { id: a.id } },
      { actor: "ai_proposal", store, bank, allowAiSuggestedStructure: true },
    );
    expect(result).toMatchObject({ status: "ready", origin: "ai_suggested" });
    if (result.status !== "ready") return;
    applyGatewayActions([result.action], store, bank, { origin: "ai_suggested" });
    expect(store.get(b.id)?.source).toEqual(originalSource);
    expect(store.get(b.id)?.parentProvenance).toMatchObject({ origin: "ai_suggested" });
  });

  it("accepts an explicit current-turn nesting instruction that cites both card references", () => {
    const { bank, store, a, b } = setup();
    const instruction = `I want to nest ${cardRef(b.id)} in ${cardRef(a.id)} without linking them`;
    const utterance = bank.add(instruction, "chat");
    const result = inspectAction(
      { kind: "nest_card", child: { id: b.id }, parent: { id: a.id }, relationEvidence: { utteranceId: utterance.id, text: instruction } },
      { actor: "ai_proposal", store, bank, turnUtteranceIds: [utterance.id] },
    );
    expect(result).toMatchObject({ status: "ready", origin: "user_asserted", action: { kind: "nest_card", child: { id: b.id }, parentId: a.id } });
  });

  it("does not treat an old or partial card-reference span as current explicit nesting intent", () => {
    const { bank, store, a, b } = setup();
    const instruction = `nest ${cardRef(b.id)} in ${cardRef(a.id)}`;
    const utterance = bank.add(instruction, "chat");
    const oldTurn = inspectAction(
      { kind: "nest_card", child: { id: b.id }, parent: { id: a.id }, relationEvidence: { utteranceId: utterance.id, text: instruction } },
      { actor: "ai_proposal", store, bank, turnUtteranceIds: [] },
    );
    const partial = inspectAction(
      { kind: "nest_card", child: { id: b.id }, parent: { id: a.id }, relationEvidence: { utteranceId: utterance.id, text: `nest ${cardRef(b.id)}` } },
      { actor: "ai_proposal", store, bank, turnUtteranceIds: [utterance.id] },
    );
    expect(oldTurn).toMatchObject({ status: "rejected", reason: "ungrounded_relationship" });
    expect(partial).toMatchObject({ status: "rejected", reason: "ungrounded_relationship" });
  });

  it("requires one-utterance relationship evidence outside suggestive mode", () => {
    const { bank, store, a, b, second } = setup();
    const missing = inspectAction({ kind: "connect_cards", source: { id: a.id }, target: { id: b.id }, labelText: "supports", labelSourceUtteranceIds: [second.id] }, { actor: "ai_proposal", store, bank, requireConnectionLabel: true });
    expect(missing).toMatchObject({ status: "rejected", reason: "ungrounded_relationship" });
    const asserted = inspectAction({ kind: "connect_cards", source: { id: b.id }, target: { id: a.id }, labelText: "supports", labelSourceUtteranceIds: [second.id], relationEvidence: { utteranceId: second.id, text: "supports" } }, { actor: "ai_proposal", store, bank, requireConnectionLabel: true, turnUtteranceIds: [second.id] });
    expect(asserted).toMatchObject({ status: "ready", origin: "user_asserted" });
  });

  it("does not accept a substring of a user word as verbatim wording", () => {
    const { bank, store } = setup();
    const utterance = bank.add("thunder is underrated", "chat");
    const result = inspectAction(
      { kind: "create_card", text: "under", sourceUtteranceIds: [utterance.id] },
      { actor: "ai_proposal", store, bank },
    );
    expect(result).toMatchObject({ status: "rejected", reason: "non_verbatim_text" });
  });

  it("requires inline relationship wording rather than a text-pending branch", () => {
    const { bank, store, a, b } = setup();
    const result = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id } },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: true, selectedCardIds: [a.id, b.id] },
    );
    expect(result).toMatchObject({ status: "needs_relationship_label", pairingProof: { kind: "selection_pair" } });
  });

  it("requires inline relationship wording even when visual edge labels are disabled", () => {
    const { bank, store, a, b } = setup();
    const result = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id } },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false, selectedCardIds: [a.id, b.id] },
    );
    expect(result).toMatchObject({ status: "needs_relationship_label", pairingProof: { kind: "selection_pair" } });
  });

  it("requires a cited current-turn utterance for co-mentioned pairing", () => {
    const { bank, store, a, b, second } = setup();
    const result = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id }, pairingProof: { kind: "co_mentioned", utteranceId: second.id } },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false, turnUtteranceIds: [second.id] },
    );
    expect(result).toMatchObject({ status: "needs_relationship_label", pairingProof: { kind: "co_mentioned", utteranceId: second.id } });
    const oldTurn = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id }, pairingProof: { kind: "co_mentioned", utteranceId: second.id } },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false, turnUtteranceIds: [] },
    );
    expect(oldTurn).toMatchObject({ status: "rejected", reason: "ungrounded_relationship" });
  });

  it("keeps an AI-selected L0 pair rejected even when both cards exist", () => {
    const { bank, store, a, b } = setup();
    const result = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id } },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false },
    );
    expect(result).toMatchObject({ status: "rejected", reason: "ungrounded_relationship" });
  });

  it("accepts one selected endpoint plus an exact named endpoint", () => {
    const { bank, store, a, b, second } = setup();
    const result = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id }, pairingProof: { kind: "selection_and_named_card", utteranceId: second.id } },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false, selectedCardIds: [a.id], turnUtteranceIds: [second.id] },
    );
    expect(result).toMatchObject({ status: "needs_relationship_label", pairingProof: { kind: "selection_and_named_card" } });
  });

  it("uses persisted pairing proof after selection has been consumed", () => {
    const { bank, store, a, b } = setup();
    const result = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id } },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false, verifiedPairingProof: { kind: "selection_pair", endpointIds: [a.id, b.id], selectedCardIds: [a.id, b.id] } },
    );
    expect(result).toMatchObject({ status: "needs_relationship_label", pairingProof: { kind: "selection_pair" } });
  });

  it("permits only grounded relationship options outside suggestive mode", () => {
    const { bank, store, a, b, second } = setup();
    const grounded = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id }, labelOptions: [{ text: "supports", sourceUtteranceIds: [second.id] }] },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false, allowGroundedOptions: true, selectedCardIds: [a.id, b.id] },
    );
    expect(grounded).toMatchObject({ status: "needs_relationship_label", options: [{ text: "supports", origin: "user_asserted" }] });
    const invented = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id }, labelOptions: [{ text: "causes", sourceUtteranceIds: [second.id] }] },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false, allowGroundedOptions: true, selectedCardIds: [a.id, b.id] },
    );
    expect(invented).toMatchObject({ status: "rejected", reason: "non_verbatim_text" });
  });

  it("revalidates current references and rejects a deleted card", () => {
    const { bank, store, a, b } = setup();
    store.delete(b.id);
    const result = inspectAction(
      { kind: "connect_cards", source: { id: a.id }, target: { id: b.id }, labelText: "supports", labelSourceUtteranceIds: [] },
      { actor: "ai_proposal", store, bank, requireConnectionLabel: false },
    );
    expect(result).toMatchObject({ status: "rejected", reason: "unknown_card" });
  });

  it("keeps direct canvas actions outside AI provenance checks", () => {
    const { bank, store } = setup();
    const result = inspectAction(
      { kind: "create_card", text: "my canvas wording", sourceUtteranceIds: [] },
      { actor: "user_canvas", store, bank },
    );
    expect(result.status).toBe("ready");
  });

  it("executes direct canvas intents through their distinct actor path", () => {
    const { bank, store, a } = setup();
    const result = executeCanvasAction({ kind: "edit_card", id: a.id, text: "my direct edit" }, { store, bank });
    expect(result.status).toBe("applied");
    expect(store.get(a.id)?.text).toBe("my direct edit");
  });

  it("rejects a translated-view canvas write before touching the store", () => {
    const { bank, store, a } = setup();
    const result = executeCanvasAction({ kind: "edit_card", id: a.id, text: "blocked" }, { store, bank, interactionMode: "translated_view" });
    expect(result).toMatchObject({ status: "rejected", reason: "read_only_view" });
    expect(store.get(a.id)?.text).not.toBe("blocked");
  });

  it("permits only snapshot restoration through the explicit system origin", () => {
    const { bank, store, a } = setup();
    const snapshot = store.snapshot();
    const edit = executeCanvasAction({ kind: "edit_card", id: a.id, text: "escape" }, { store, bank, interactionMode: "translated_view", origin: "system_restore" });
    expect(edit).toMatchObject({ status: "rejected", reason: "origin_not_permitted" });
    expect(store.get(a.id)?.text).not.toBe("escape");
    const restored = executeCanvasAction({ kind: "restore_snapshot", snapshot }, { store, bank, interactionMode: "translated_view", origin: "system_restore" });
    expect(restored.status).toBe("applied");
    expect(store.get(a.id)?.text).toBe(a.text);
  });

  it("does not expose snapshot restoration to a user canvas execution", () => {
    const { bank, store } = setup();
    const result = executeCanvasAction({ kind: "restore_snapshot", snapshot: store.snapshot() }, { store, bank, interactionMode: "authoring", origin: "user" });
    expect(result).toMatchObject({ status: "rejected", reason: "origin_not_permitted" });
  });

  it("rejects invalid direct canvas cycles before mutation", () => {
    const { bank, store, a, b } = setup();
    executeCanvasAction({ kind: "set_parent", id: b.id, parentId: a.id, role: "content" }, { store, bank });
    const result = executeCanvasAction({ kind: "set_parent", id: a.id, parentId: b.id, role: "content" }, { store, bank });
    expect(result).toMatchObject({ status: "rejected", reason: "nest_cycle" });
    expect(store.get(a.id)?.parentId).toBeUndefined();
  });

  it("preserves AI-reflection provenance at the confirmed consequence boundary", () => {
    const { store, first } = setup();
    const result = applyConfirmedReflection({ id: "reflection-1", text: "human control matters", candidateId: "candidate", target: "idea", sourceUtteranceIds: [first.id], confirmedAt: 1 }, store);
    expect(result.status).toBe("applied");
    expect(store.get(result.status === "applied" ? result.cardId! : "")?.source).toMatchObject({ reflectionId: "reflection-1", createdBy: "ai_from_reflection" });
  });
});
