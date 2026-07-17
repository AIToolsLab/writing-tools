import { afterEach, describe, expect, it, vi } from "vitest";
import { historyForCurrentTurn, makeLLM, parseAssistantResponse, PROVIDER_TRANSPORT, renderContext } from "./api";
import { defaultConfig } from "./config";
import type { LLMContext } from "./llm-contract";
import { ThoughtUnitStore } from "./map-store";
import { createConversationState, processTurn } from "./stage1-loop";

const context: LLMContext = {
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
    expect(parseAssistantResponse({ response: { kind: "question", text: "What matters here?", stance: "deepen" }, advisory: { candidateDeletes: ["c1"] } })).toEqual({ response: { kind: "question", text: "What matters here?", stance: "deepen" }, advisory: { candidateUpserts: [], candidateDeletes: ["c1"] } });
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

  it("renders factual UI context without a duplicate latest-user-turn prompt field", () => {
    const rendered = renderContext({
      ...context,
      candidates: [{ id: "candidate-1", target: "connection", gist: "human control", evidenceUtteranceIds: ["u_1"] }],
      selectedFocus: { cards: [{ id: "tu_1", ref: "A", text: "human control", role: "node" }] },
      requestedSupport: "deepen",
    });

    expect(rendered).toContain("EXPLICIT UI SELECTION");
    expect(rendered).toContain("A human control");
    expect(rendered).toContain("'deepen' support control");
    expect(rendered).toContain("sparse=true");
    expect(rendered).toContain("value=75 on a 0 (Think) to 100 (Map) control");
    expect(rendered).toContain("TURN SHAPE (measurement only)");
    expect(rendered).toContain("A draft paragraph.");
    expect(rendered).toContain("candidate-1 connection human control evidence=u_1");
    expect(rendered).not.toContain("readiness=");
    expect(rendered).not.toContain("LATEST USER TURN");
  });

  it("keeps the rejected assistant response in repair-local history", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "What is at stake?", stance: "deepen" } }) } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ response: { kind: "question", text: "What would make that clearer?", stance: "narrow" } }) } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    const model = makeLLM(defaultConfig, historyForCurrentTurn([
      { role: "assistant", content: "What relationship are you testing?" },
    ], "It is about human control."));

    await model(context);
    await model(context, { code: "reflection_validation_failed", detail: "Pointer was not exact." });

    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages;
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string).messages;
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(request).toMatchObject({ model: "gpt-5.6-terra", reasoning_effort: "low" });
    expect(first.at(-1)).toEqual({ role: "user", content: "It is about human control." });
    expect(second).toContainEqual({ role: "assistant", content: "What is at stake?" });
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
    const model = makeLLM(defaultConfig, historyForCurrentTurn([], "Human control matters."), undefined, "responses_tools");

    expect((await model(context)).response.kind).toBe("map_proposal");
    expect((await model(context, { code: "non_verbatim_text", detail: "Not user wording." })).response.kind).toBe("question");

    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(fetchMock.mock.calls[0][0]).toContain("/openai/responses");
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
      makeLLM(defaultConfig, [{ role: "user", content: "human control matters" }], undefined, "chat_json"),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
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
