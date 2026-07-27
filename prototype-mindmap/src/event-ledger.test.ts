import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLedger, sanitizedEvent } from "./event-ledger";

afterEach(() => vi.unstubAllGlobals());

describe("event ledger", () => {
  it("keeps full detail local while sanitized events omit it", () => {
    const event = { sessionId: "s", sequence: 1, at: 1, kind: "user_message" as const, detail: { text: "private draft wording" } };
    expect(sanitizedEvent(event)).toEqual({ sessionId: "s", sequence: 1, at: 1, kind: "user_message" });
  });

  it("allows only explicit provider-tool metadata into the sanitized event", () => {
    const event = { sessionId: "s", sequence: 2, at: 2, kind: "provider_tool_requested" as const, detail: { arguments: "private words" } };
    expect(sanitizedEvent(event, { providerTransport: "responses_tools", toolName: "propose_map_action_v1", repairCount: 0 })).toEqual({
      sessionId: "s", sequence: 2, at: 2, kind: "provider_tool_requested",
      providerTransport: "responses_tools", toolName: "propose_map_action_v1", repairCount: 0,
    });
  });

  it("sanitizes recall telemetry without sending candidate ids or user wording", () => {
    const event = { sessionId: "s", sequence: 3, at: 3, kind: "candidate_recalled" as const, detail: { candidateId: "private", userPhrase: "private wording" } };
    expect(sanitizedEvent(event, { outcome: "recalled", code: "candidate_recalled", candidateStatus: "parked", ageInTurns: 6 })).toEqual({
      sessionId: "s", sequence: 3, at: 3, kind: "candidate_recalled", outcome: "recalled", code: "candidate_recalled", candidateStatus: "parked", ageInTurns: 6,
    });
  });

  it("sanitizes adoption telemetry to origin, outcome, and percentages", () => {
    const event = { sessionId: "s", sequence: 4, at: 4, kind: "suggestion_adoption_changed" as const, origin: "ai_suggested" as const, detail: { cardId: "private", trace: { adoptedFromMessageId: 9 } } };
    expect(sanitizedEvent(event, { outcome: "updated", currentPercentage: 42, peakPercentage: 75 })).toEqual({
      sessionId: "s", sequence: 4, at: 4, kind: "suggestion_adoption_changed", origin: "ai_suggested", outcome: "updated", currentPercentage: 42, peakPercentage: 75,
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
