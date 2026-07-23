import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, withQuestionIntentBias } from "./config";
import { ThoughtUnitStore } from "./map-store";
import { buildContext, createConversationState, deriveClaimAttribution, MAX_MODEL_CALLS_PER_TURN, MAX_REFLECTION_ATTEMPTS, processTurn } from "./stage1-loop";
import { cardRef, resetIdCounter } from "./store";
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

  it("keeps a user-language pattern through coach-only turns without treating it as evidence", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const firstModel = vi.fn(async () => ({ response: { kind: "question" as const, text: "你最在意什么？", stance: "deepen" as const } }));
    await processTurn(state, "我在想作者身份", firstModel, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, uiLocale: "ar" });
    expect(state.latestUserLanguagePattern).toBe("single");
    expect(firstModel).toHaveBeenCalledWith(expect.objectContaining({ language: { uiLocale: "ar", latestUserLanguagePattern: "single" } }), undefined);

    const continuation = vi.fn(async () => ({ response: { kind: "question" as const, text: "还想从哪里开始？", stance: "deepen" as const } }));
    await processTurn(state, "", continuation, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, uiLocale: "zh" });
    expect(continuation).toHaveBeenCalledWith(expect.objectContaining({ language: { uiLocale: "zh", latestUserLanguagePattern: "single" } }), undefined);
    expect(state.bank.getAll().map((item) => item.text)).toEqual(["我在想作者身份"]);
  });

  it("keeps a direct language request as authored conversation rather than a stored preference", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (_context: import("./llm-contract").LLMContext) => ({ response: { kind: "question" as const, text: "What should the response focus on?", stance: "deepen" as const } }));
    const request = "Please respond in Chinese.";
    await processTurn(state, request, model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, uiLocale: "en" });

    expect(state.bank.getAll().map((item) => item.text)).toEqual([request]);
    expect(model).toHaveBeenCalledWith(expect.objectContaining({ language: { uiLocale: "en", latestUserLanguagePattern: "single" } }), undefined);
    expect(model.mock.calls[0]?.[0].language.preferredCoachLanguage).toBeUndefined();
  });

  it("leaves validation outcomes unchanged by the advisory language pattern", async () => {
    const run = async (pattern: "single" | "mixed" | "unknown", claimText: string) => {
      const state = createConversationState();
      state.latestUserLanguagePattern = pattern;
      const utterance = state.bank.add("original wording", "chat");
      const store = new ThoughtUnitStore();
      const result = await processTurn(state, "", async () => ({ response: {
        kind: "grounded_recap" as const,
        text: claimText,
        recap: { claims: [{ id: "r1", text: claimText, target: "idea" as const, sourceSpans: [{ claimText, userPhrase: claimText, utteranceIds: [utterance.id] }] }] },
      } }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
      return { response: result.response, proposal: result.proposal, diagnostics: result.diagnostics.map((event) => [event.outcome, event.code]) };
    };

    const patterns: Array<"single" | "mixed" | "unknown"> = ["single", "mixed", "unknown"];
    const valid = await Promise.all(patterns.map((pattern) => run(pattern, "original wording")));
    const invalid = await Promise.all(patterns.map((pattern) => run(pattern, "ungrounded wording")));
    expect(valid).toEqual([valid[0], valid[0], valid[0]]);
    expect(invalid).toEqual([invalid[0], invalid[0], invalid[0]]);
  });

  it("renders a typed question without creating proposal or map state", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(state, "I am exploring authorship", async () => ({ response: { kind: "question", text: "What does authorship protect?", stance: "deepen" } }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(result.response?.kind).toBe("question");
    expect(result.proposal).toBeUndefined();
    expect(store.getAll()).toHaveLength(0);
  });

  it("renders an L0 current-turn recap from validated user wording without creating capturable structure", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(state, "language communicates ideas imperfectly", async (context) => {
      const sourceId = context.bank.find((utterance) => utterance.origin === "chat")!.id;
      return { response: { kind: "grounded_recap" as const, text: "The model-authored wrapper is not displayed.", recap: { claims: [{
        id: "r1", text: "language communicates ideas imperfectly", target: "idea" as const,
        sourceSpans: [{ claimText: "language communicates ideas imperfectly", userPhrase: "language communicates ideas imperfectly", utteranceIds: [sourceId] }],
      }] } } };
    }, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] });

    expect(result.response).toMatchObject({ kind: "grounded_recap", text: "language communicates ideas imperfectly" });
    expect(result.proposal).toBeUndefined();
    expect(state.candidates.getAll()).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "grounded_recap_valid" }));
  });

  it("keeps L0 recaps on the current user turn while allowing L1 to bring user turns together", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    await processTurn(state, "language communicates ideas imperfectly", async () => ({ response: { kind: "question" as const, text: "What contributes to meaning?" } }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    const recapModel = vi.fn(async (context: import("./llm-contract").LLMContext, rejection?: import("./assistant-response").StructuredRejection) => {
      if (rejection) return { response: { kind: "question" as const, text: "What belongs together for you?" } };
      const chat = context.bank.filter((utterance) => utterance.origin === "chat");
      return { response: { kind: "grounded_recap" as const, text: "recap", recap: { claims: [
        { id: "r1", text: "language communicates ideas imperfectly", target: "idea" as const, sourceSpans: [{ claimText: chat[0]!.text, userPhrase: chat[0]!.text, utteranceIds: [chat[0]!.id] }] },
        { id: "r2", text: "memories contribute to meaning", target: "idea" as const, sourceSpans: [{ claimText: chat[1]!.text, userPhrase: chat[1]!.text, utteranceIds: [chat[1]!.id] }] },
      ] } } };
    });

    const l0 = await processTurn(state, "memories contribute to meaning", recapModel, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] });
    expect(l0.response).toMatchObject({ kind: "question" });
    expect(recapModel.mock.calls[1]?.[1]).toMatchObject({ code: "grounded_recap_not_current_turn" });

    const l1 = await processTurn(state, "memories contribute to meaning", recapModel, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[1] });
    expect(l1.response).toMatchObject({ kind: "grounded_recap", text: "language communicates ideas imperfectly\nmemories contribute to meaning" });
    expect(l1.proposal).toBeUndefined();
  });

  it("rejects recap wording and candidate nominations that cross the conversational-only boundary", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context: import("./llm-contract").LLMContext, rejection?: import("./assistant-response").StructuredRejection) => {
      if (rejection) return { response: { kind: "question" as const, text: "What are you trying to understand?" } };
      const sourceId = context.bank.find((utterance) => utterance.origin === "chat")!.id;
      return {
        response: { kind: "grounded_recap" as const, text: "recap", recap: { claims: [{ id: "r1", text: "what the writer is trying to understand", target: "idea" as const, sourceSpans: [{ claimText: "what I am trying to understand", userPhrase: "what I am trying to understand", utteranceIds: [sourceId] }] }] } },
        advisory: { candidateUpserts: [{ id: "r1", target: "idea" as const, gist: "understanding", addEvidenceIds: [sourceId], status: "active" as const }] },
      };
    });

    const result = await processTurn(state, "what I am trying to understand", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(result.response).toMatchObject({ kind: "question" });
    expect(model.mock.calls[1]?.[1]).toMatchObject({ code: "grounded_recap_candidate_advisory_not_allowed" });
    expect(state.candidates.getAll()).toHaveLength(0);
  });

  it("rejects unsupported recap substitutions such as writer for I", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context: import("./llm-contract").LLMContext, rejection?: import("./assistant-response").StructuredRejection) => {
      if (rejection) return { response: { kind: "question" as const, text: "What are you trying to understand?" } };
      const sourceId = context.bank.find((utterance) => utterance.origin === "chat")!.id;
      return { response: { kind: "grounded_recap" as const, text: "recap", recap: { claims: [{
        id: "r1", text: "what the writer is trying to understand", target: "idea" as const,
        sourceSpans: [{ claimText: "what I am trying to understand", userPhrase: "what I am trying to understand", utteranceIds: [sourceId] }],
      }] } } };
    });

    const result = await processTurn(state, "what I am trying to understand", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(model.mock.calls[1]?.[1]).toMatchObject({ code: "grounded_recap_validation_failed" });
    expect(result.response).toMatchObject({ kind: "question" });
  });

  it("repairs a question whose draft anchor is not an exact current-draft substring", async () => {
    const state = createConversationState();
    state.draft = "Those classes probably did matter.";
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (_context, rejection) => rejection
      ? { response: { kind: "question" as const, text: "What should the reader understand?", stance: "narrow" as const } }
      : { response: { kind: "question" as const, text: "Why does this matter?", stance: "deepen" as const, anchor: "Those classes definitely mattered." } });

    const result = await processTurn(state, "Help me think through this draft.", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1]?.[1]).toMatchObject({ code: "draft_anchor_not_exact" });
    expect(result.response).toMatchObject({ kind: "question", stance: "narrow" });
    expect(result.diagnostics.some((event) => event.code === "draft_anchor_not_exact")).toBe(true);
  });

  it("accepts a selective question anchor that is exact draft wording", async () => {
    const state = createConversationState();
    state.draft = "Those classes probably did matter.";
    const store = new ThoughtUnitStore();
    const model = vi.fn(async () => ({ response: { kind: "question" as const, text: "What changed here?", stance: "deepen" as const, anchor: "classes probably did matter" } }));

    const result = await processTurn(state, "I am struggling to explain why this result matters.", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    expect(model).toHaveBeenCalledTimes(1);
    expect(result.response).toMatchObject({ kind: "question", anchor: "classes probably did matter" });
  });

  it("rejects an L0 reflection that cites draft evidence", async () => {
    const state = createConversationState();
    state.draft = "Language shapes belonging.";
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context: import("./llm-contract").LLMContext, rejection) => rejection
      ? { response: { kind: "question" as const, text: "What feels connected here?" } }
      : { response: { kind: "reflection" as const, text: "A mirror.", reflection: { claims: [{
        id: "c1", text: "language shapes belonging", candidateId: "c1", target: "idea" as const,
        sourceSpans: [{ claimText: "language shapes belonging", userPhrase: "language shapes belonging", utteranceIds: [context.bank.find((u) => u.origin === "draft")!.id] }],
      }] } } });

    const result = await processTurn(state, "Help with this draft.", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] });
    expect(model).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.diagnostics.some((event) => event.code === "reflection_cites_draft_at_l0")).toBe(true);
  });

  it("accepts an L1 draft-grounded mirror and records ai_connected provenance", async () => {
    const state = createConversationState();
    state.draft = "Language shapes belonging.";
    const store = new ThoughtUnitStore();
    const result = await processTurn(state, "I keep thinking about belonging.", async (context: import("./llm-contract").LLMContext) => {
      const draftId = context.bank.find((u) => u.origin === "draft")!.id;
      const chatId = context.bank.find((u) => u.origin === "chat")!.id;
      return { response: { kind: "reflection" as const, text: "A mirror.", reflection: { claims: [{
        id: "c1", text: "language shapes belonging; I keep thinking about belonging", candidateId: "c1", target: "idea" as const,
        sourceSpans: [
          { claimText: "language shapes belonging", userPhrase: "language shapes belonging", utteranceIds: [draftId] },
          { claimText: "I keep thinking about belonging", userPhrase: "I keep thinking about belonging", utteranceIds: [chatId] },
        ],
      }] } }, advisory: { candidateUpserts: [{ id: "c1", target: "idea" as const, gist: "belonging", addEvidenceIds: [draftId, chatId], status: "active" as const }] } };
    }, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[1] });
    expect(result.response).toMatchObject({ kind: "reflection" });
    expect(result.proposal?.origin).toBe("ai_connected");
  });

  it("reserves cross-turn reflection synthesis for L1 and records it as ai_connected", async () => {
    const makeState = () => {
      const state = createConversationState();
      state.bank.addSegmented("language communicates ideas imperfectly", "chat");
      state.bank.addSegmented("memories contribute to meaning", "chat");
      return state;
    };
    const responseFor = (context: import("./llm-contract").LLMContext) => {
      const chat = context.bank.filter((utterance) => utterance.origin === "chat");
      return {
        response: { kind: "reflection" as const, text: "mirror", reflection: { claims: [{
          id: "c1", candidateId: "c1", target: "idea" as const,
          text: "language communicates ideas imperfectly and memories contribute to meaning",
          sourceSpans: [
            { claimText: chat[0]!.text, userPhrase: chat[0]!.text, utteranceIds: [chat[0]!.id] },
            { claimText: chat[1]!.text, userPhrase: chat[1]!.text, utteranceIds: [chat[1]!.id] },
          ],
        }] } },
        advisory: { candidateUpserts: [{ id: "c1", target: "idea" as const, gist: "language and meaning", addEvidenceIds: chat.map((utterance) => utterance.id), status: "active" as const }] },
      };
    };

    const l0State = makeState();
    const l0Store = new ThoughtUnitStore();
    const l0Model = vi.fn(async (context: import("./llm-contract").LLMContext, rejection?: import("./assistant-response").StructuredRejection) => rejection
      ? { response: { kind: "question" as const, text: "Which part do you want to stay with?" } }
      : responseFor(context));
    const l0 = await processTurn(l0State, "", l0Model, defaultConfig, l0Store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store: l0Store, contract: ASSISTANCE_CONTRACTS[0] });
    expect(l0Model.mock.calls[1]?.[1]).toMatchObject({ code: "reflection_connects_turns_at_l0" });
    expect(l0.response).toMatchObject({ kind: "question" });

    const l1State = makeState();
    const l1Store = new ThoughtUnitStore();
    const l1 = await processTurn(l1State, "", async (context) => responseFor(context), defaultConfig, l1Store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store: l1Store, contract: ASSISTANCE_CONTRACTS[1] });
    expect(l1.response).toMatchObject({ kind: "reflection" });
    expect(l1.proposal?.origin).toBe("ai_connected");
  });

  it("keeps sentence pieces from one user turn user_asserted", async () => {
    const state = createConversationState();
    state.bank.addSegmented("language communicates ideas imperfectly. memories contribute to meaning.", "chat");
    const store = new ThoughtUnitStore();
    const result = await processTurn(state, "", async (context) => {
      const chat = context.bank.filter((utterance) => utterance.origin === "chat");
      return {
        response: { kind: "reflection" as const, text: "mirror", reflection: { claims: [{
          id: "c1", candidateId: "c1", target: "idea" as const,
          text: "language communicates ideas imperfectly and memories contribute to meaning",
          sourceSpans: chat.map((utterance) => ({ claimText: utterance.text, userPhrase: utterance.text, utteranceIds: [utterance.id] })),
        }] } },
        advisory: { candidateUpserts: [{ id: "c1", target: "idea" as const, gist: "language and meaning", addEvidenceIds: chat.map((utterance) => utterance.id), status: "active" as const }] },
      };
    }, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] });
    expect(result.proposal?.origin).toBe("user_asserted");
  });

  it("repairs an L1 draft-only reflection before ordinary pointer validation", async () => {
    const state = createConversationState();
    state.draft = "Language shapes belonging.";
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context: import("./llm-contract").LLMContext, rejection) => rejection
      ? { response: { kind: "question" as const, text: "What part of belonging matters here?" } }
      : { response: { kind: "reflection" as const, text: "A mirror.", reflection: { claims: [{
        id: "c1", text: "language shapes belonging", candidateId: "c1", target: "idea" as const,
        sourceSpans: [{ claimText: "language shapes belonging", userPhrase: "language shapes belonging", utteranceIds: [context.bank.find((u) => u.origin === "draft")!.id] }],
      }] } } });
    const result = await processTurn(state, "Help me think.", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[1] });
    expect(model.mock.calls[1]?.[1]).toMatchObject({ code: "reflection_draft_without_chat_anchor" });
    expect(result.response).toMatchObject({ kind: "question" });
  });

  it("rejects a relationship assembled across draft and chat evidence", async () => {
    const state = createConversationState();
    state.draft = "Language shapes belonging.";
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context: import("./llm-contract").LLMContext, rejection) => {
      if (rejection) return { response: { kind: "question" as const, text: "How do those ideas relate in your view?" } };
      const draftId = context.bank.find((u) => u.origin === "draft")!.id;
      const chatId = context.bank.find((u) => u.origin === "chat")!.id;
      return { response: { kind: "reflection" as const, text: "A mirror.", reflection: { claims: [{
        id: "c1", text: "language shapes belonging supports human control", candidateId: "c1", target: "connection" as const,
        sourceSpans: [
          { claimText: "language shapes belonging", userPhrase: "language shapes belonging", utteranceIds: [draftId] },
          { claimText: "human control", userPhrase: "human control", utteranceIds: [chatId] },
        ],
        relationSpan: { utteranceId: draftId, text: "shapes" },
      }] } } };
    });
    const result = await processTurn(state, "Human control matters.", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[1] });
    expect(model.mock.calls[1]?.[1]).toMatchObject({ code: "reflection_validation_failed" });
    expect(result.response).toMatchObject({ kind: "question" });
  });

  it("keeps only the latest draft snapshot in model context", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    state.draft = "First draft wording.";
    await processTurn(state, "One.", async () => ({ response: { kind: "question" as const, text: "What matters?" } }), defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    state.draft = "Second draft wording.";
    let latestContext: Awaited<ReturnType<typeof processTurn>> | undefined;
    const model = vi.fn(async (context: import("./llm-contract").LLMContext) => {
      expect(context.bank.some((u) => u.text === "First draft wording.")).toBe(false);
      expect(context.bank.some((u) => u.text === "Second draft wording.")).toBe(true);
      return { response: { kind: "question" as const, text: "What changed?" } };
    });
    latestContext = await processTurn(state, "Two.", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });
    expect(latestContext.response).toMatchObject({ kind: "question" });
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

  it("repairs a reflection with a fully grounded mirror before rendering it", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => {
      const sourceId = context.bank[0]!.id;
      if (!rejection) {
        return {
          response: {
            kind: "reflection" as const,
            text: "A possible mirror.",
            reflection: { claims: [{
              id: "c1", text: "human control necessarily matters", candidateId: "c1", target: "idea" as const,
              sourceSpans: [{ claimText: "human control matters", userPhrase: "human control matters", utteranceIds: [sourceId] }],
            }] },
          },
          advisory: { candidateUpserts: [{ id: "c1", target: "idea" as const, gist: "human control", addEvidenceIds: [sourceId], status: "active" as const }] },
        };
      }
      return {
        response: {
          kind: "reflection" as const,
          text: "A possible mirror.",
          reflection: { claims: [{
            id: "c1", text: "human control matters", candidateId: "c1", target: "idea" as const,
            sourceSpans: [{ claimText: "human control matters", userPhrase: "human control matters", utteranceIds: [sourceId] }],
          }] },
        },
        advisory: { candidateUpserts: [{ id: "c1", target: "idea" as const, gist: "human control", addEvidenceIds: [sourceId], status: "active" as const }] },
      };
    });

    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1]?.[1]).toMatchObject({ code: "reflection_validation_failed" });
    expect(result.response).toMatchObject({ kind: "reflection" });
    expect(result.proposal).toMatchObject({ origin: "user_asserted", state: "shown" });
    expect(result.terminal).toBeUndefined();
  });

  it("rejects the reported writer-for-I authorship leak with the exact unsupported word", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => {
      if (rejection) return { response: { kind: "question" as const, text: "What does that phrase help you understand?", stance: "deepen" as const } };
      const sourceId = context.bank[0]!.id;
      return {
        response: {
          kind: "reflection" as const,
          text: "You identify a useful phrase.",
          reflection: { claims: [{
            id: "c1",
            text: "more adequate to capture the nature intensity and mood of my inquiry is a good representation of what the writer is trying to understand",
            candidateId: "c1",
            target: "idea" as const,
            sourceSpans: [{
              claimText: "more adequate to capture the nature intensity and mood of my inquiry is a good representation of what I am trying to understand",
              userPhrase: "more adequate to capture the nature intensity and mood of my inquiry is a good representation of what I am trying to understand",
              utteranceIds: [sourceId],
            }],
          }] },
        },
        advisory: { candidateUpserts: [{ id: "c1", target: "idea" as const, gist: "nature intensity and mood", addEvidenceIds: [sourceId], status: "active" as const }] },
      };
    });

    const result = await processTurn(
      state,
      "more adequate to capture the nature intensity and mood of my inquiry is a good representation of what I am trying to understand",
      model,
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store },
    );

    expect(model.mock.calls[1]?.[1]?.reflectionRecovery?.ungroundedContentWords).toEqual(["writer"]);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.proposal).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "reflection_validation_failed",
      detail: expect.stringContaining("Unsupported content words: writer"),
    }));
  });

  it("derives displayed reflection text from the same validated claims used by the proposal", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(state, "human control matters", async (context) => {
      const sourceId = context.bank[0]!.id;
      return {
        response: {
          kind: "reflection" as const,
          text: "This free-form wrapper invents an interpretation that was never validated.",
          reflection: { claims: [{
            id: "c1", text: "human control matters", candidateId: "c1", target: "idea" as const,
            sourceSpans: [{ claimText: "human control matters", userPhrase: "human control matters", utteranceIds: [sourceId] }],
          }] },
        },
        advisory: { candidateUpserts: [{ id: "c1", target: "idea" as const, gist: "human control", addEvidenceIds: [sourceId], status: "active" as const }] },
      };
    }, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    expect(result.response).toMatchObject({ kind: "reflection", text: "human control matters" });
    expect(result.proposal?.detail.kind).toBe("reflection");
    if (result.proposal?.detail.kind === "reflection") {
      expect(result.proposal.detail.editedTexts.c1).toBe(result.response?.text);
    }
    expect(state.lastAssistantText).toBe("human control matters");
  });

  it("uses the capped two-reflection ladder and renders the forced question", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const progress: Array<{ stage: string; modelCall: number }> = [];
    const model = vi.fn(async (context, rejection) => {
      if (rejection?.reflectionRecovery?.stage === "forced_question") {
        return { response: { kind: "question" as const, text: "What makes control feel necessary here?", stance: "deepen" as const } };
      }
      const sourceId = context.bank[0]!.id;
      const second = Boolean(rejection);
      return {
        response: {
          kind: "reflection" as const,
          text: "A possible mirror.",
          reflection: { claims: [{
            id: `c${second ? 2 : 1}`,
            text: second ? "human control inevitably matters" : "human control necessarily matters",
            candidateId: `c${second ? 2 : 1}`,
            target: "idea" as const,
            sourceSpans: [{ claimText: "human control matters", userPhrase: "human control matters", utteranceIds: [sourceId] }],
          }] },
        },
        advisory: { candidateUpserts: [{ id: `c${second ? 2 : 1}`, target: "idea" as const, gist: "human control", addEvidenceIds: [sourceId], status: "active" as const }] },
      };
    });

    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), {
      mapRevision: 0, requireConnectionLabel: true, store, onProgress: (event) => progress.push(event),
    });

    expect(MAX_REFLECTION_ATTEMPTS).toBe(2);
    expect(MAX_MODEL_CALLS_PER_TURN).toBe(3);
    expect(model).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([
      { stage: "initial_attempt", modelCall: 1 },
      { stage: "grounding_repair", modelCall: 2 },
      { stage: "forced_question", modelCall: 3 },
    ]);
    expect(model.mock.calls[1]?.[1]?.reflectionRecovery).toMatchObject({
      stage: "informed_repair",
      ungroundedContentWords: ["necessarily"],
      rejectedReflections: [{ kind: "reflection" }],
    });
    expect(model.mock.calls[2]?.[1]?.reflectionRecovery).toMatchObject({
      stage: "forced_question",
      ungroundedContentWords: ["necessarily", "inevitably"],
    });
    expect(model.mock.calls[2]?.[1]?.reflectionRecovery?.rejectedReflections).toHaveLength(2);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.terminal).toBeUndefined();
    expect(state.candidates.getAll()).toHaveLength(0);
  });

  it("ends recovery when the forced-question call returns another response kind", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => {
      if (rejection?.reflectionRecovery?.stage === "forced_question") {
        return { response: { kind: "aside" as const, text: "Let us pause here." } };
      }
      return { response: {
        kind: "reflection" as const,
        text: "A possible mirror.",
        reflection: { claims: [{
          id: "c1", text: "human control necessarily matters", candidateId: "c1", target: "idea" as const,
          sourceSpans: [{ claimText: "human control matters", userPhrase: "human control matters", utteranceIds: [context.bank[0]!.id] }],
        }] },
      } };
    });

    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store });

    expect(model).toHaveBeenCalledTimes(3);
    expect(result.terminal).toMatchObject({ kind: "repair_failed" });
    expect(result.diagnostics.some((event) => event.code === "forced_question_kind_invalid")).toBe(true);
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

  it("proposes an explicitly instructed card-reference nesting without asking for another relationship description", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const parentUtterance = state.bank.add("language communicates ideas", "chat");
    const childUtterance = state.bank.add("memories contribute to meaning", "chat");
    const parent = store.addFromUserUtterance(parentUtterance);
    const child = store.addFromUserUtterance(childUtterance);
    const userText = `I want to nest ${cardRef(child.id)} in ${cardRef(parent.id)} without linking them`;
    const model = vi.fn(async (context: import("./llm-contract").LLMContext) => {
      const instruction = context.bank.find((utterance) => utterance.text === userText)!;
      return { response: { kind: "map_proposal" as const, text: "Review this nesting.", action: {
        kind: "nest_card" as const,
        child: { id: child.id }, parent: { id: parent.id },
        relationEvidence: { utteranceId: instruction.id, text: userText },
      } } };
    });

    const result = await processTurn(state, userText, model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] });
    expect(model).toHaveBeenCalledTimes(1);
    expect(result.proposal).toMatchObject({ state: "shown", origin: "user_asserted", detail: { kind: "map_action", executable: { kind: "nest_card", child: { id: child.id }, parentId: parent.id } } });
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

  it("allows an L2 proposal to retain explicitly AI-suggested provenance", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      state,
      "I am exploring control.",
      async () => ({ response: {
        kind: "map_proposal" as const,
        text: "Here is one AI suggestion to review.",
        action: { kind: "create_card" as const, text: "a lens of authorship", sourceUtteranceIds: [] },
      } }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[2] },
    );

    expect(result.response).toMatchObject({ kind: "map_proposal" });
    expect(result.proposal).toMatchObject({ state: "shown", origin: "ai_suggested", contract: { level: 2 } });
    expect(store.getAll()).toHaveLength(0);
  });

  it("does not relax reflection faithfulness at L2", async () => {
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const model = vi.fn(async (context, rejection) => rejection
      ? { response: { kind: "suggestion" as const, text: "One AI suggestion is to examine authorship." } }
      : { response: {
        kind: "reflection" as const,
        text: "A possible mirror.",
        reflection: { claims: [{
          id: "c1", text: "human control necessarily matters", candidateId: "c1", target: "idea" as const,
          sourceSpans: [{ claimText: "human control matters", userPhrase: "human control matters", utteranceIds: [context.bank[0]!.id] }],
        }] },
      } });

    const result = await processTurn(state, "human control matters", model, defaultConfig, store.toLLMContext(), { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[2] });

    expect(model).toHaveBeenCalledTimes(2);
    expect(model.mock.calls[1]?.[1]).toMatchObject({ code: "reflection_validation_failed" });
    expect(result.response).toMatchObject({ kind: "suggestion" });
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
