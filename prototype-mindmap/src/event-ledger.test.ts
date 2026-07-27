import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLedger } from "./event-ledger";

afterEach(() => vi.unstubAllGlobals());

describe("event ledger", () => {
  it("persists every local metadata field on the recorded event", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const event = await new EventLedger("s").record(
      "provider_tool_result",
      { private: "local detail" },
      {
        responseKind: "question",
        origin: "ai_suggested",
        outcome: "accepted",
        code: "ok",
        durationMs: 12,
        providerTransport: "responses_tools",
        toolName: "propose_map_action_v1",
        repairCount: 1,
        candidateStatus: "parked",
        ageInTurns: 4,
        currentPercentage: 42,
        peakPercentage: 75,
      },
    );
    expect(event).toMatchObject({
      responseKind: "question",
      origin: "ai_suggested",
      outcome: "accepted",
      code: "ok",
      durationMs: 12,
      providerTransport: "responses_tools",
      toolName: "propose_map_action_v1",
      repairCount: 1,
      candidateStatus: "parked",
      ageInTurns: 4,
      currentPercentage: 42,
      peakPercentage: 75,
    });
  });

  it("keeps monotonically increasing in-memory sequence when IndexedDB is unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const ledger = new EventLedger("s");
    expect((await ledger.record("contract_initialized")).sequence).toBe(1);
    expect((await ledger.record("contract_changed")).sequence).toBe(2);
    expect(ledger.isAvailable).toBe(false);
  });

  it("serializes concurrent records so sequence numbers cannot collide", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const ledger = new EventLedger("s");
    const events = await Promise.all([
      ledger.record("user_message"),
      ledger.record("assistant_response"),
      ledger.record("proposal_created"),
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("records locally without making a telemetry request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("indexedDB", undefined);
    await new EventLedger("local-only").record("model_request", { private: "prompt" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
