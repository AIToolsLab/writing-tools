import { afterEach, describe, expect, it, vi } from "vitest";
import { historyForCurrentTurn, makeLLM, parseAssistantResponse, PROVIDER_TRANSPORT, renderContext, translateReaderText } from "./api";
import { defaultConfig } from "./config";
import type { LLMContext } from "./llm-contract";
import { ThoughtUnitStore } from "./map-store";
import { createConversationState, processTurn } from "./stage1-loop";
import { contractForLevel, snapshotContract } from "./assistance-contract";

const context: LLMContext = {
  language: { uiLocale: "en", latestUserLanguagePattern: "single" },
  bank: [{ id: "u_1", text: "I want to keep human control.", timestamp: 1, origin: "chat", turnId: "t_1" }],
  candidates: [],
  turnShape: { kind: "compact", reasons: [], utteranceCount: 1, contentTokenCount: 5, characterCount: 29 },
  capabilities: defaultConfig.capabilities,
  mapPacing: { cardCount: 1, connectionCount: 0, isSparse: true },
  reflectionRhythm: { turnsSinceLastReflection: 2, sourceUtteranceCount: 1 },
  thinkMapBias: 75,
  map: { thoughtUnits: [], connections: [] },
  draft: "A draft paragraph.",
};

afterEach(() => vi.unstubAllGlobals());

describe("typed assistant response parser", () => {
  it("keeps the existing JSON transport as the default", () => {
    expect(PROVIDER_TRANSPORT).toBe("chat_json");
  });
  it("parses exactly one visible response and separate advisory data", () => {
    expect(parseAssistantResponse({ response: { kind: "question", text: "What matters here?", stance: "deepen" }, advisory: { candidateDeletes: ["c1"] } })).toEqual({ response: { kind: "question", text: "What matters here?", stance: "deepen" }, advisory: { candidateUpserts: [] } });
  });

  it("requires a relation pointer on the parsed relational claim payload", () => {
    const parsed = parseAssistantResponse({ response: { kind: "reflection", text: "Here is what I heard.", reflection: { claims: [{ id: "c1", text: "A supports B", candidateId: "x", target: "connection", sourceSpans: [{ claimText: "A supports B", utteranceIds: ["u1"], userPhrase: "A supports B" }], relationSpan: { utteranceId: "u1", text: "supports" } }] } } });
    expect(parsed.response.kind === "reflection" && parsed.response.reflection.claims[0].relationSpan).toEqual({ utteranceId: "u1", text: "supports" });
  });

  it("rejects unknown visible response kinds", () => {
    expect(() => parseAssistantResponse({ response: { kind: "command", text: "Do it" } })).toThrow("unknown_response_kind");
  });

  it("builds a current-turn transcript with the newest user message exactly once at the end", () => {
    const history = historyForCurrentTurn([
      { role: "user", content: "I am uncertain." },
      { role: "assistant", content: "What feels uncertain?" },
    ], "The relationship is about control.");

    expect(history).toEqual([
      { role: "user", content: "I am uncertain." },
      { role: "assistant", content: "What feels uncertain?" },
      { role: "user", content: "The relationship is about control." },
    ]);
  });

  it("parses a grounded recap without a candidate or proposal payload", () => {
    const parsed = parseAssistantResponse({ response: { kind: "grounded_recap", text: "A recap.", recap: { claims: [{ id: "r1", text: "human control matters", target: "idea", sourceSpans: [{ claimText: "human control matters", utteranceIds: ["u_1"], userPhrase: "human control matters" }] }] } } });
    expect(parsed.response).toMatchObject({ kind: "grounded_recap", recap: { claims: [{ id: "r1", text: "human control matters" }] } });
    if (parsed.response.kind === "grounded_recap") expect(parsed.response.recap.claims[0]).not.toHaveProperty("candidateId");
  });

  it("parses an explicitly attributed translation without a second visible-text field", () => {
    const parsed = parseAssistantResponse({ response: {
      kind: "translation",
      sourceEvidence: [{ utteranceIds: ["u_1"], userPhrase: "人类控制" }],
      targetLanguage: "English",
      translatedText: "human control",
      provenance: "ai_translated",
    } });
    expect(parsed.response).toEqual({
      kind: "translation",
      text: "human control",
      sourceEvidence: [{ utteranceIds: ["u_1"], userPhrase: "人类控制" }],
      targetLanguage: "English",
      translatedText: "human control",
      provenance: "ai_translated",
    });
  });

  it("rejects translations without the fixed AI-translation provenance", () => {
    expect(() => parseAssistantResponse({ response: {
      kind: "translation",
      sourceEvidence: [{ utteranceIds: ["u_1"], userPhrase: "人类控制" }],
      targetLanguage: "English",
      translatedText: "human control",
      provenance: "user_asserted",
    } })).toThrow("invalid_translation_payload");
  });

  it("parses structured question and aside recall plus explicit map candidate linkage", () => {
    const recall = { candidateId: "memory", sourceUtteranceId: "u_1", userPhrase: "human control" };
    expect(parseAssistantResponse({ response: { kind: "question", text: "Return to human control?", recall } }).response).toMatchObject({ kind: "question", recall });
    expect(parseAssistantResponse({ response: { kind: "aside", text: "Earlier: human control.", recall } }).response).toMatchObject({ kind: "aside", recall });
    expect(parseAssistantResponse({
      response: {
        kind: "map_proposal",
        text: "Review this.",
        candidateId: "memory",
        action: { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
      },
    }).response).toMatchObject({ kind: "map_proposal", candidateId: "memory" });
  });

  it("rejects malformed or unsupported recall annotations and drops forbidden lifecycle nominations", () => {
    expect(() => parseAssistantResponse({ response: { kind: "question", text: "Return?", recall: { candidateId: "memory" } } })).toThrow("invalid_recall_payload");
    expect(() => parseAssistantResponse({ response: { kind: "suggestion", text: "Return to this.", recall: { candidateId: "memory", sourceUtteranceId: "u_1", userPhrase: "this" } } })).toThrow("invalid_recall_kind");
    const parsed = parseAssistantResponse({ response: { kind: "aside", text: "Stay here." }, advisory: { candidateUpserts: [{ id: "memory", target: "idea", gist: "x", addEvidenceIds: ["u_1"], status: "ignored" }] } });
    expect(parsed.advisory?.candidateUpserts).toEqual([]);
  });

  it("preserves ordering within the history window while keeping the new user turn last", () => {
    const committed = Array.from({ length: 21 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `committed-${index}`,
    }));

    const history = historyForCurrentTurn(committed, "anaphoric reply");

    expect(history).toHaveLength(20);
    expect(history).toEqual([
      ...committed.slice(-19),
      { role: "user", content: "anaphoric reply" },
    ]);
    expect(history.filter((message) => message.content === "anaphoric reply")).toHaveLength(1);
    expect(history[history.length - 1]).toEqual({ role: "user", content: "anaphoric reply" });
  });

  it("renders factual UI context without a duplicate latest-user-turn prompt field", () => {
    const rendered = renderContext({
      ...context,
      candidates: [{ id: "candidate-1", target: "connection", status: "parked", gist: "human control", ageInTurns: 3, evidence: [{ utteranceId: "u_1", text: "human control" }] }],
      selectedFocus: {
        cards: [{ id: "tu_1", ref: "A", text: "human control", role: "node" }],
        draftText: "the highlighted draft claim",
      },
      requestedSupport: "deepen",
    });

    expect(rendered).toContain("EXPLICIT UI SELECTION");
    expect(rendered).toContain("A human control");
    expect(rendered).toContain("draft selection: the highlighted draft claim");
    expect(rendered).toContain("'deepen' support control");
    expect(rendered).toContain("sparse=true");
    expect(rendered).toContain("value=75 on a 0 (Think) to 100 (Map) control");
    expect(rendered).toContain("TURN SHAPE (measurement only)");
    expect(rendered).toContain("LANGUAGE GUIDANCE (advisory, never evidence)");
    expect(rendered).toContain("Interface display locale=en; this is presentation-only and is not a response-language preference.");
    expect(rendered).toContain("Latest user language pattern=single.");
    expect(rendered).toContain("kind=compact; utterances=1; contentTokens=5; characters=29");
    expect(rendered).toContain(`Can do: ${defaultConfig.capabilities.canDo.join("; ")}`);
    expect(rendered).toContain(`Cannot do: ${defaultConfig.capabilities.cantDo.join("; ")}`);
    expect(rendered).toContain("A draft paragraph.");
    expect(rendered).toContain("candidate-1 target=connection status=parked ageInTurns=3 gist=human control");
    expect(rendered).toContain('[u_1] "human control"');
    expect(rendered).toContain("RECALL-ELIGIBLE CANDIDATES");
    expect(rendered).toContain("DO NOT RECALL OR SURFACE THESE CANDIDATES");
    expect(rendered).not.toContain("readiness=");
    expect(rendered).not.toContain("detectedSignals");
    expect(rendered).not.toContain("LATEST USER TURN");
  });

  it("keeps the rejected assistant response in repair-local history", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "What is at stake?", stance: "deepen" } }) } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "What would make that clearer?", stance: "narrow" } }) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig, { initialHistory: historyForCurrentTurn([
      { role: "assistant", content: "What relationship are you testing?" },
    ], "It is about human control.") });

    await model(context);
    await model(context, { code: "reflection_validation_failed", detail: "Pointer was not exact." });

    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages;
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).messages;
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({ model: "gpt-5.6-terra", reasoning_effort: "low" });
    expect(first.at(-1)).toEqual({ role: "user", content: "It is about human control." });
    expect(second).toContainEqual({ role: "assistant", content: "What is at stake?" });
    expect(second[0].content).toContain("Your previous response was rejected by code");
    expect(second[0].content).toContain("reflection_validation_failed");
    expect(second[0].content).toContain("Pointer was not exact.");
    expect(second[0].content).toContain("targeted, context-specific question");
    expect(second[0].content).toContain("expose validation");
    expect(second[0].content).toContain("First try a fully grounded mirror");
    expect(second[0].content).toContain("Do not translate, convert scripts, or modernize quoted evidence.");
    expect(second[0].content).toContain("targeted, context-specific question");
    expect(first[0].content).toContain("Treat the full draft as background context and a user selection as explicit focus.");
    expect(first[0].content).toContain("Use draft anchors selectively, and distinguish model-chosen anchors from user-selected focus.");
    expect(first[0].content).toContain("The interface display locale is never an instruction to translate or change reply language.");
    expect(first[0].content).toContain("Preserve authored passages and quoted evidence in their original language.");
    expect(first[0].content).toContain("Every reflection and grounded recap at every assistance level must be strictly user-word-faithful");
    expect(first[0].content).toContain("exact original-language userPhrase evidence");
    expect(first[0].content).toContain("Never translate substantive evidence inside a mirror.");
    expect(first[0].content).toContain("Only emit a translation response when the user directly asks you to translate.");
    expect(first[0].content).toContain("Do not create candidates, a proposal, a card, a relationship, or an adoption path from a translation.");
    expect(first[0].content).toContain("Use a grounded recap when conversational consolidation is useful");
    expect(first[0].content).toContain("a reflection may draw from only one recorded user moment");
    expect(first[0].content).toContain("explicitly instructs you to nest one referenced card in another");
    expect(first[0].content).toContain("Use direct quotation only when it makes the referent clearer");
    expect(first[0].content).toContain("For a large or abstract turn");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders a distinct L0 objective and guards against premise-smuggling in questions", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "How do these belong together for you?" } }) } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig);

    await model({ ...context, assistanceContract: snapshotContract(contractForLevel(0)) });

    const messages = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages;
    expect(messages[0].content).toContain("L0 NON-DIRECTIVE OBJECTIVE");
    expect(messages[0].content).toContain("presupposition inside a question");
    expect(messages[0].content).toContain("A direct request for help does not authorize you to choose the answer");
    expect(messages[0].content).toContain("do not smuggle it into the question");
    expect(messages[0].content).not.toContain("L2 SUGGESTIVE OBJECTIVE");
  });

  it("renders a distinct L2 objective that requires visible attribution for novel contributions", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "suggestion", text: "AI suggestion: try a possible lens." } }) } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig);

    await model({ ...context, assistanceContract: snapshotContract(contractForLevel(2)) });

    const messages = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages;
    expect(messages[0].content).toContain("L2 SUGGESTIVE OBJECTIVE");
    expect(messages[0].content).toContain('must begin with "AI suggestion:"');
    expect(messages[0].content).toContain("not a high frequency of suggestions");
    expect(messages[0].content).toContain("do not replace either with a more interesting model-chosen focus");
    expect(messages[0].content).toContain("move it into an explicitly attributed suggestion");
    expect(messages[0].content).toContain("never invent a dangling candidateId");
    expect(messages[0].content).toContain("one exact contiguous substring from DRAFT");
    expect(messages[0].content).not.toContain("L0 NON-DIRECTIVE OBJECTIVE");
  });

  it("uses a bounded Responses tool repair with the matching call id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        id: "resp_1",
        output: [{ type: "function_call", name: "propose_map_action_v1", call_id: "call_1", arguments: JSON.stringify({ text: "Review this.", action: { kind: "create_card", text: "invented", sourceUtteranceIds: ["u_1"] }, advisory: null }) }],
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        id: "resp_2",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ response: { kind: "question", text: "Which words should become the card?", stance: "narrow", anchor: null }, advisory: null }) }] }],
      }) });
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig, {
      initialHistory: historyForCurrentTurn([], "Human control matters."),
      transport: "responses_tools",
      runtime: { bearerToken: "wtk_responses" },
    });

    expect((await model(context)).response.kind).toBe("map_proposal");
    expect((await model(context, { code: "non_verbatim_text", detail: "Not user wording." })).response.kind).toBe("question");

    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(fetchMock.mock.calls[0][0]).toContain("/openai/responses");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wtk_responses",
      },
    });
    expect(first).toMatchObject({ store: false, parallel_tool_calls: false, tool_choice: "auto" });
    expect(second.input).toContainEqual({ type: "function_call_output", call_id: "call_1", output: JSON.stringify({ status: "rejected", rejection: { code: "non_verbatim_text", detail: "Not user wording." } }) });
  });

  it("uses exactly two Chat requests when invalid JSON needs the one loop repair", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "{" } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "Which wording matters?" } }) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      createConversationState(),
      "human control matters",
      makeLLM(defaultConfig, { initialHistory: [{ role: "user", content: "human control matters" }], transport: "chat_json" }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
  });

  it("records provider timing and token usage without changing the parsed response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "What matters?" } }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const trace = vi.fn();
    const model = makeLLM(defaultConfig, { onTrace: trace });

    expect((await model(context)).response.kind).toBe("question");
    expect(trace).toHaveBeenCalledWith(expect.objectContaining({
      durationMs: expect.any(Number), inputTokens: 12, outputTokens: 5, totalTokens: 17,
      structuredResponseOutcome: "accepted", toolArgumentOutcome: "not_applicable",
    }));
  });

  it("injects bearer auth and reports a platform-marked 401", async () => {
    const onAccessError = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("Unauthorized", {
      status: 401,
      headers: { "X-Writing-Tools-Error": "platform-auth" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig, {
      runtime: { bearerToken: "wtk_runtime", onAccessError },
    });

    await expect(model(context)).rejects.toThrow("Backend 401");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wtk_runtime",
      },
    });
    expect(onAccessError).toHaveBeenCalledWith(401);
  });

  it("leaves unmarked upstream 401 and 403 errors retryable", async () => {
    const onAccessError = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Provider unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("Provider forbidden", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig, { runtime: { onAccessError } });

    await expect(model(context)).rejects.toThrow("Backend 401");
    await expect(model(context)).rejects.toThrow("Backend 403");
    expect(onAccessError).not.toHaveBeenCalled();
  });

  it("forces the third recovery prompt to request exactly one question", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "What is missing?" } }) } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig);
    await model(context, {
      code: "reflection_forced_question",
      detail: "Two attempts failed.",
      reflectionRecovery: {
        stage: "forced_question",
        ungroundedContentWords: ["necessarily"],
        rejectedReflections: [],
      },
    });
    const messages = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages;
    expect(messages[0].content).toContain("Return exactly one question response now");
    expect(messages[0].content).toContain("necessarily");
    expect(messages[0].content).toContain("Do not return a reflection");
  });
});

describe("reader translation transport", () => {
  it("uses the injected bearer without requiring browser storage", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ translation: "hola" }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(translateReaderText("hello", "Spanish", {
      bearerToken: "wtk_reader",
    })).resolves.toBe("hola");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wtk_reader",
      },
    });
  });
});

describe("calibration context", () => {
  it("renders proposal resolution and reflection rhythm as advisory facts", () => {
    const rendered = renderContext({
      ...context,
      reflectionRhythm: { turnsSinceLastReflection: 4, sourceUtteranceCount: 7 },
      proposalOutcome: { proposalKind: "map_action", decision: "confirmed" },
    });
    expect(rendered).toContain("The user confirmed a map change");
    expect(rendered).toContain("assistant turns since the last reflection=4");
    expect(rendered).toContain("source-bank entries available=7");
  });
});
