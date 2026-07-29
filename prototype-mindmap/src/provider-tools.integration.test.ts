import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeLLM } from "./api";
import { ASSISTANCE_CONTRACTS } from "./assistance-contract";
import { defaultConfig } from "./config";
import { ThoughtUnitStore } from "./map-store";
import { createConversationState, processTurn } from "./stage1-loop";
import { resetIdCounter } from "./store";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => resetIdCounter());

function response(body: unknown) { return { ok: true, json: async () => body }; }

describe("Responses tool pipeline", () => {
  it("turns a grounded provider tool call into an inert L0 proposal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      id: "resp_grounded",
      output: [{
        type: "function_call", name: "propose_map_action_v1", call_id: "call_grounded",
        arguments: JSON.stringify({ text: "Review this card.", action: { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] }, advisory: null }),
      }],
    })));
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      state,
      "human control matters",
      makeLLM(defaultConfig, { initialHistory: [{ role: "user", content: "human control matters" }], transport: "responses_tools" }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] },
    );
    expect(result.proposal).toMatchObject({ state: "shown", origin: "user_asserted", detail: { kind: "map_action" } });
    expect(store.getAll()).toHaveLength(0);
  });

  it("repairs an ungrounded L0 tool request once and never stages it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        id: "resp_bad",
        output: [{
          type: "function_call", name: "propose_map_action_v1", call_id: "call_bad",
          arguments: JSON.stringify({ text: "Review this card.", action: { kind: "create_card", text: "invented authorship lens", sourceUtteranceIds: ["u_1"] }, advisory: null }),
        }],
      }))
      .mockResolvedValueOnce(response({
        id: "resp_repair",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ response: { kind: "question", text: "Which of your words should become the card?", stance: "narrow", anchor: null }, advisory: null }) }] }],
      }));
    vi.stubGlobal("fetch", fetchMock);
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      state,
      "human control matters",
      makeLLM(defaultConfig, { initialHistory: [{ role: "user", content: "human control matters" }], transport: "responses_tools" }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[0] },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.response).toMatchObject({ kind: "question" });
    expect(result.proposal).toBeUndefined();
    expect(store.snapshot()).toMatchObject({ units: [], connections: [] });
  });

  it("retains AI-suggested origin for an L2 structural tool request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      output: [{
        type: "function_call", name: "propose_map_action_v1", call_id: "call_l2",
        arguments: JSON.stringify({ text: "Here is an AI suggestion to review.", action: { kind: "create_card", text: "an authorship lens", sourceUtteranceIds: [] }, advisory: null }),
      }],
    })));
    const state = createConversationState();
    const store = new ThoughtUnitStore();
    const result = await processTurn(
      state,
      "I am exploring control",
      makeLLM(defaultConfig, { initialHistory: [{ role: "user", content: "I am exploring control" }], transport: "responses_tools" }),
      defaultConfig,
      store.toLLMContext(),
      { mapRevision: 0, requireConnectionLabel: true, store, contract: ASSISTANCE_CONTRACTS[2] },
    );
    expect(result.proposal).toMatchObject({ state: "shown", origin: "ai_suggested" });
    expect(store.getAll()).toHaveLength(0);
  });
});
