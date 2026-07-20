import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, withQuestionIntentBias } from "./config";
import { ThoughtUnitStore } from "./map-store";
import { buildContext, createConversationState, deriveClaimAttribution, processTurn } from "./stage1-loop";
import { resetIdCounter } from "./store";
import { ASSISTANCE_CONTRACTS } from "./assistance-contract";
import { ModelResponseValidationError } from "./assistant-response";

beforeEach(() => resetIdCounter());

describe("typed Stage 1 controller", () => {
  it("passes the explicit Think/Map preference as factual model context", () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const context = buildContext(
      state,
      "human control matters",
      [],
      store.toLLMContext(),
      withQuestionIntentBias(defaultConfig, 75),
    );
    expect(context.thinkMapBias).toBe(75);
    expect(context.reflectionRhythm).toEqual({ turnsSinceLastReflection: 0, sourceUtteranceCount: 0 });
  });

  it("renders a typed question without creating proposal or map state", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(state, "I am exploring authorship", async () => ({ response: { kind: "question", text: "What does authorship protect?", stance: "deepen" } }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(result.response?.kind).toBe("question");
    expect(result.proposal).toBeUndefined();
    expect(store.getAll()).toHaveLength(0);
  });

  it("repairs one rejected map proposal and still leaves it inert", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => {
      const sourceId = context.bank[0]?.id ?? "missing";
      return rejection
        ? { response: { kind: "map_proposal" as const, text: "Review this.", action: { kind: "create_card" as const, text: "human control", sourceUtteranceIds: [sourceId] } } }
        : { response: { kind: "map_proposal" as const, text: "Review this.", action: { kind: "create_card" as const, text: "invented framing", sourceUtteranceIds: [sourceId] } } };
    });
    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 4, requireConnectionLabel: true, store });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.proposal).toMatchObject({ state: "shown", mapRevision: 4 });
    expect(result.diagnostics.some((event) => event.code === "repair_succeeded")).toBe(true);
    expect(store.getAll()).toHaveLength(0);
  });

  it("returns an application terminal after the single repair also fails", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context) => ({ response: { kind: "map_proposal" as const, text: "Review this.", action: { kind: "create_card" as const, text: "invented framing", sourceUtteranceIds: [context.bank[0]?.id ?? "missing"] } } }));
    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toBeUndefined();
    expect(result.proposal).toBeUndefined();
    expect(result.terminal).toMatchObject({ kind: "repair_failed" });
    expect(result.diagnostics[result.diagnostics.length - 1]?.code).toBe("repair_failed");
  });

  it("uses the same single repair budget for an unparsable provider response", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (_context, rejection) => {
      if (!rejection) throw new ModelResponseValidationError("invalid_provider_tool_arguments");
      return { response: { kind: "question" as const, text: "Which wording matters most?", stance: "narrow" as const } };
    });
    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.diagnostics.filter((event) => event.code === "repair_requested")).toHaveLength(1);
  });

  it("returns a terminal when an unparsable response also fails its only repair", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async () => { throw new ModelResponseValidationError("invalid_provider_tool_arguments"); });
    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toBeUndefined();
    expect(result.terminal).toMatchObject({ kind: "repair_failed" });
    expect(result.diagnostics[result.diagnostics.length - 1]?.code).toBe("repair_failed");
  });

  it("does not disguise a backend outage as a model repair", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async () => { throw new Error("Backend 503: unavailable"); });
    await expect(processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store })).rejects.toThrow("Backend 503");
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("returns a terminal when the semantic repair response is malformed", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => {
      if (rejection) throw new ModelResponseValidationError("invalid_provider_json");
      return { response: { kind: "map_proposal" as const, text: "Review this.", action: { kind: "create_card" as const, text: "invented framing", sourceUtteranceIds: [context.bank[0]?.id ?? "missing"] } } };
    });
    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toBeUndefined();
    expect(result.terminal).toMatchObject({ kind: "repair_failed" });
    expect(result.diagnostics[result.diagnostics.length - 1]?.code).toBe("repair_failed");
  });

  it("allows a rejected reflection to repair into a valid context-specific question", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (_context, rejection) => rejection
      ? { response: { kind: "question" as const, text: "What part of human control feels most important here?", stance: "deepen" as const } }
      : { response: { kind: "reflection" as const, text: "Here is what I heard.", reflection: { claims: [{ id: "c1", text: "invented framing", candidateId: "c1", target: "idea" as const, sourceSpans: [] }] } } });

    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.terminal).toBeUndefined();
    expect(result.diagnostics.some((event) => event.code === "repair_succeeded")).toBe(true);
  });

  it("returns a terminal when a contract rejection is rejected again", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async () => ({ response: { kind: "suggestion" as const, text: "Try transparency as the umbrella." } }));

    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] });

    expect(model).toHaveBeenCalledTimes(2);
    expect(result.terminal).toMatchObject({ kind: "repair_failed" });
    expect(result.diagnostics.some((event) => event.code === "contract_response_kind_not_allowed")).toBe(true);
  });

  it("can retry a failed turn without adding the user wording to the Source Bank again", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const failed = await processTurn(
      state,
      "human control matters",
      async () => ({ response: { kind: "suggestion", text: "Try transparency as the umbrella." } }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] },
    );
    const bankCount = state.bank.getAll().length;

    const retried = await processTurn(
      state,
      "",
      async () => ({ response: { kind: "aside", text: "We can stay with the wording you have." } }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] },
    );

    expect(failed.terminal).toMatchObject({ kind: "repair_failed" });
    expect(state.bank.getAll()).toHaveLength(bankCount);
    expect(state.currentUserTurn).toBe(1);
    expect(retried.response).toMatchObject({ kind: "aside" });
    expect(retried.terminal).toBeUndefined();
  });

  it("ages candidates only across user turns and resets age on a verified update", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    await processTurn(state, "Transparency can become surveillance.", async (context) => ({
      response: { kind: "aside", text: "We can hold that concern." },
      advisory: { candidateUpserts: [{ id: "memory", target: "idea", gist: "surveillance concern", addEvidenceIds: [context.bank[0]!.id], status: "parked" }] },
    }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    await processTurn(state, "Transparency is still on my mind.", async () => ({ response: { kind: "aside", text: "Stay with what matters." } }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(state.currentUserTurn).toBe(2);
    expect(state.candidates.ageInTurns("memory", state.currentUserTurn)).toBe(1);

    await processTurn(state, "", async () => ({
      response: { kind: "aside", text: "We can keep it available." },
      advisory: { candidateUpserts: [{ id: "memory", target: "idea", gist: "surveillance concern", addEvidenceIds: [], status: "parked" }] },
    }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(state.currentUserTurn).toBe(2);
    expect(state.candidates.ageInTurns("memory", state.currentUserTurn)).toBe(0);
  });

  it("validates and records a grounded recall without imposing a minimum age", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    await processTurn(state, "Transparency can become surveillance.", async (context) => ({
      response: { kind: "aside", text: "I will hold that." },
      advisory: { candidateUpserts: [{ id: "memory", target: "idea", gist: "surveillance concern", addEvidenceIds: [context.bank[0]!.id], status: "parked" }] },
    }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    const sourceId = state.candidates.get("memory")!.evidenceUtteranceIds[0];

    const result = await processTurn(state, "Something is missing.", async () => ({ response: {
      kind: "question",
      text: "Earlier you said transparency can become surveillance. Do you want to return to that?",
      recall: { candidateId: "memory", sourceUtteranceId: sourceId, userPhrase: "transparency can become surveillance" },
    } }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    expect(result.recall).toEqual({ candidateId: "memory", sourceUtteranceId: sourceId, userPhrase: "transparency can become surveillance", ageInTurns: 1 });
    expect(state.candidates.get("memory")).toMatchObject({ status: "parked", lastRecalledTurn: 2, lastTouchedTurn: 2 });
    expect(result.diagnostics.some((event) => event.code === "candidate_recalled")).toBe(true);
  });

  it("repairs an invalid recall once and may switch to an ordinary aside", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (_context, rejection) => rejection
      ? { response: { kind: "aside" as const, text: "We can stay with what is here." } }
      : { response: { kind: "question" as const, text: "Want to return to an earlier thought?", recall: { candidateId: "missing", sourceUtteranceId: "u_missing", userPhrase: "earlier thought" } } });
    const result = await processTurn(state, "Something is missing.", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "aside" });
    expect(result.recall).toBeUndefined();
    expect(result.diagnostics.some((event) => event.code === "recall_candidate_unknown")).toBe(true);
  });

  it("rejects every ineligible recall pointer deterministically", async () => {
    const cases: Array<{ name: string; status?: "active" | "parked" | "ignored" | "promoted"; sourceMode?: "linked" | "unlinked" | "command" | "aside"; phrase?: string; visible?: string; code: string }> = [
      { name: "ignored", status: "ignored", code: "recall_candidate_ineligible" },
      { name: "promoted", status: "promoted", code: "recall_candidate_ineligible" },
      { name: "unlinked", sourceMode: "unlinked", code: "recall_evidence_unlinked" },
      { name: "command-only", sourceMode: "command", code: "recall_evidence_ineligible" },
      { name: "non-harvestable", sourceMode: "aside", code: "recall_evidence_ineligible" },
      { name: "non-verbatim", phrase: "surveillance is always harmful", code: "recall_phrase_not_verbatim" },
      { name: "not visible", visible: "Do you want to return to that concern?", code: "recall_phrase_not_visible" },
    ];
    for (const scenario of cases) {
      const state = createConversationState();
      state.currentUserTurn = 1;
      const linked = state.bank.add("Transparency can become surveillance.");
      const other = state.bank.add("Accountability matters.");
      if (scenario.sourceMode === "command") state.bank.markCommandOnly([linked.id]);
      if (scenario.sourceMode === "aside") state.bank.markNonHarvestable([linked.id]);
      state.candidates.replaceAll([{
        id: "memory", target: "idea", gist: "surveillance", evidenceUtteranceIds: [linked.id],
        status: scenario.status ?? "parked", createdTurn: 1, lastTouchedTurn: 1,
      }]);
      const sourceUtteranceId = scenario.sourceMode === "unlinked" ? other.id : linked.id;
      const model = vi.fn(async () => ({ response: {
        kind: "aside" as const,
        text: scenario.visible ?? "Earlier you said transparency can become surveillance.",
        recall: { candidateId: "memory", sourceUtteranceId, userPhrase: scenario.phrase ?? "transparency can become surveillance" },
      } }));
      const result = await processTurn(state, "", model, defaultConfig, new ThoughtUnitStore().toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store: new ThoughtUnitStore() });
      expect(model, scenario.name).toHaveBeenCalledTimes(2);
      expect(result.terminal, scenario.name).toMatchObject({ kind: "repair_failed" });
      expect(result.diagnostics.some((event) => event.code === scenario.code), scenario.name).toBe(true);
    }
  });

  it("keeps map candidate linkage explicit and target checked", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const linked = await processTurn(state, "Human control matters.", async (context) => ({
      response: { kind: "map_proposal", text: "Review this.", candidateId: "memory", action: { kind: "create_card", text: "Human control matters", sourceUtteranceIds: [context.bank[0]!.id] } },
      advisory: { candidateUpserts: [{ id: "memory", target: "idea", gist: "human control", addEvidenceIds: [context.bank[0]!.id], status: "active" }] },
    }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(linked.proposal?.detail).toMatchObject({ kind: "map_action", candidateId: "memory" });

    const mismatch = await processTurn(state, "These ideas belong together.", async () => ({
      response: { kind: "map_proposal", text: "Review this.", candidateId: "memory", action: { kind: "connect_cards", source: {}, target: {}, labelText: "together", labelSourceUtteranceIds: [] } },
    }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(mismatch.terminal).toMatchObject({ kind: "repair_failed" });
    expect(mismatch.diagnostics.some((event) => event.code === "map_candidate_invalid")).toBe(true);
  });

  it("does not commit advisory updates from a rejected response", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => rejection
      ? { response: { kind: "question" as const, text: "Which wording matters?" }, advisory: { candidateUpserts: [{ id: "accepted", target: "idea" as const, gist: "human control", addEvidenceIds: [context.bank[0]!.id], status: "active" as const }] } }
      : { response: { kind: "map_proposal" as const, text: "Review this.", action: { kind: "create_card" as const, text: "invented framing", sourceUtteranceIds: [context.bank[0]!.id] } }, advisory: { candidateUpserts: [{ id: "rejected", target: "idea" as const, gist: "invented framing", addEvidenceIds: [context.bank[0]!.id], status: "active" as const }] } });
    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(result.response).toMatchObject({ kind: "question" });
    expect(state.candidates.get("rejected")).toBeUndefined();
    expect(state.candidates.get("accepted")).toBeDefined();
  });

  it("never returns an invalid reflection to the UI", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => {
      if (rejection) return { response: { kind: "question" as const, text: "What wording feels important here?", stance: "deepen" as const } };
      const sourceId = context.bank[0]?.id ?? "missing";
      return {
        response: {
          kind: "reflection" as const,
          text: "A possible mirror.",
          reflection: {
            claims: [{
              id: "invalid-claim",
              text: "invented framing",
              candidateId: "candidate",
              target: "idea" as const,
              sourceSpans: [{ claimText: "invented framing", userPhrase: "invented framing", utteranceIds: [sourceId] }],
            }],
          },
        },
      };
    });

    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.proposal).toBeUndefined();
    expect(result.diagnostics.some((event) => event.code === "reflection_validation_failed")).toBe(true);
  });

  it("records inline-completion proposals as unresolved, not AI-inferred", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      state,
      "human control matters",
      async (context) => ({ response: { kind: "map_proposal", text: "Complete this proposal.", action: { kind: "create_card", text: "", sourceUtteranceIds: [context.bank[0]!.id] } } }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store },
    );
    expect(result.proposal).toMatchObject({ origin: "unresolved", detail: { kind: "map_action", completion: { kind: "generic", fields: ["text"] } } });
  });

  it("turns an unlabelled L0 connection into inline completion without spending a repair", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const first = state.bank.add("the power of language", "chat");
    const second = state.bank.add("my experience in English class", "chat");
    const source = store.addFromUserUtterance(first);
    const target = store.addFromUserUtterance(second);
    const model = vi.fn(async () => ({
      response: {
        kind: "map_proposal" as const,
        text: "Review this connection.",
        action: { kind: "connect_cards" as const, source: { id: source.id }, target: { id: target.id } },
      },
    }));
    const result = await processTurn(
      state,
      "Connect that to the other card.",
      model,
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: false, store, contract: ASSISTANCE_CONTRACTS[0], selectedCardIds: [source.id, target.id] },
    );
    expect(model).toHaveBeenCalledTimes(1);
    expect(result.proposal).toMatchObject({ origin: "user_asserted", detail: { kind: "map_action", completion: { kind: "relationship_label", pairingProof: { kind: "selection_pair" } } } });
    expect(result.diagnostics.some((event) => event.code === "repair_requested")).toBe(false);
  });

  it("derives relational attribution from verified pointers", () => {
    const state = createConversationState();
    const utterance = state.bank.add("transparency supports human control", "chat");
    const claim = { id: "c1", text: "transparency supports human control", candidateId: "candidate", target: "connection" as const, sourceSpans: [{ claimText: "transparency supports human control", utteranceIds: [utterance.id], userPhrase: "transparency supports human control" }], relationSpan: { utteranceId: utterance.id, text: "supports" } };
    expect(deriveClaimAttribution(claim, state.bank.getAll())).toBe("asserted");
    expect(deriveClaimAttribution({ ...claim, relationSpan: { utteranceId: utterance.id, text: "causes" } }, state.bank.getAll())).toBe("inferred");
  });

  it("does not derive asserted attribution from a relation substring", () => {
    const state = createConversationState();
    const utterance = state.bank.add("thunder is underrated", "chat");
    const claim = {
      id: "c-substring",
      text: "thunder under discussion",
      candidateId: "candidate",
      target: "connection" as const,
      sourceSpans: [{ claimText: "thunder", utteranceIds: [utterance.id], userPhrase: "thunder" }],
      relationSpan: { utteranceId: utterance.id, text: "under" },
    };
    expect(deriveClaimAttribution(claim, state.bank.getAll())).toBe("inferred");
  });

  it("repairs an L0 suggestion instead of rendering it", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (_context, rejection) => rejection
      ? { response: { kind: "question" as const, text: "What wording feels central?" } }
      : { response: { kind: "suggestion" as const, text: "Consider authorship as the main lens." } });
    const result = await processTurn(state, "I am exploring control", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.diagnostics.some((event) => event.code === "contract_response_kind_not_allowed")).toBe(true);
  });

  it("rejects invented L1 option text even when its evidence span is valid", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => {
      const id = context.bank[0]!.id;
      return rejection
        ? { response: { kind: "options" as const, text: "Choose one.", options: [{ text: "human control", sourceSpans: [{ claimText: "human control", userPhrase: "human control", utteranceIds: [id] }] }] } }
        : { response: { kind: "options" as const, text: "Choose one.", options: [{ text: "central authorship lens", sourceSpans: [{ claimText: "human control", userPhrase: "human control", utteranceIds: [id] }] }] } };
    });
    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[1] });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "options", options: [{ text: "human control" }] });
    expect(result.diagnostics.some((event) => event.code === "contract_options_not_verbatim")).toBe(true);
  });

  it("records exact prior-assistant overlap as influence evidence without blocking an asserted proposal", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      state,
      "Yes, transparency supports human control.",
      async (context) => ({ response: { kind: "map_proposal", text: "Review this.", action: { kind: "create_card", text: "transparency supports human control", sourceUtteranceIds: [context.bank[0]!.id] } } }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0], priorAssistant: { id: 9, text: "You said transparency supports human control?" } },
    );
    expect(result.proposal).toMatchObject({ origin: "user_asserted", influenceTrace: { priorAssistantMessageId: 9, exactOverlapPhrases: ["transparency supports human control"], overlapRatio: 1 } });
  });

  it("reports a partial overlap ratio when only some cited phrases echo the coach", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      state,
      "Language shapes thought. Translation reveals meaning.",
      async (context) => ({
        response: {
          kind: "reflection",
          text: "Here's what I hear.",
          reflection: {
            claims: [
              { id: "c1", text: "language shapes thought", candidateId: "x", target: "idea", sourceSpans: [{ claimText: "language shapes thought", userPhrase: "language shapes thought", utteranceIds: [context.bank[0]!.id] }] },
              { id: "c2", text: "translation reveals meaning", candidateId: "y", target: "idea", sourceSpans: [{ claimText: "translation reveals meaning", userPhrase: "translation reveals meaning", utteranceIds: [context.bank[1]!.id] }] },
            ],
          },
        },
        advisory: {
          candidateUpserts: [
            { id: "x", target: "idea", gist: "language shapes thought", addEvidenceIds: [context.bank[0]!.id], status: "active" },
            { id: "y", target: "idea", gist: "translation reveals meaning", addEvidenceIds: [context.bank[1]!.id], status: "active" },
          ],
        },
      }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0], priorAssistant: { id: 4, text: "How does language shapes thought fit in?" } },
    );
    // One of the two cited phrases echoes the coach → 50%.
    expect(result.proposal?.influenceTrace).toMatchObject({ exactOverlapPhrases: ["language shapes thought"], overlapRatio: 0.5 });
  });
});
