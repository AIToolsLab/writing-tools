import { describe, expect, it, vi } from "vitest";
import {
  SESSION_STORAGE_KEY,
  loadPersistedSession,
  writePersistedSession,
  type PersistedSession,
} from "./session-persistence";

function shell(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    version: 7,
    msgs: [],
    confirmed: [],
    mapRevision: 0,
    questionBias: 0,
    draftText: "",
    draftCollapsed: false,
    draftPos: { x: 0, y: 0 },
    draftSize: { w: 100, h: 100 },
    bank: [],
    candidates: [],
    map: { units: [], positions: {}, connections: [] },
    ...overrides,
  };
}

describe("session persistence", () => {
  it("removes an obsolete empty shell instead of writing it", () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    writePersistedSession(storage, shell());
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(SESSION_STORAGE_KEY);
  });

  it("persists failed recovery bubbles but excludes pending messages", () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    const session = shell({
      msgs: [
        { id: 1, role: "user", text: "failed", deliveryStatus: "failed" },
        { id: 2, role: "user", text: "pending", deliveryStatus: "pending" },
      ],
    });
    writePersistedSession(storage, session);
    expect(storage.setItem).toHaveBeenCalledOnce();
    const written = JSON.parse(storage.setItem.mock.calls[0]![1]) as PersistedSession;
    expect(written.msgs).toEqual([
      { id: 1, role: "user", text: "failed", deliveryStatus: "failed" },
    ]);
  });

  it("ignores legacy empty rows when loading", () => {
    expect(loadPersistedSession({
      getItem: () => JSON.stringify(shell()),
    })).toBeNull();
  });
});
