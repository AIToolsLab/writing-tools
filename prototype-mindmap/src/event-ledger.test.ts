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
});
