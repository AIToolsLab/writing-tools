import { describe, expect, it } from "vitest";
import { CandidateStore } from "./store";
import type { CandidateThought } from "./types";

function candidate(overrides: Partial<CandidateThought> = {}): CandidateThought {
  return {
    id: "c1",
    target: "idea",
    gist: "human control",
    evidenceUtteranceIds: ["u1"],
    status: "active",
    createdTurn: 1,
    lastTouchedTurn: 1,
    ...overrides,
  };
}

describe("candidate lifecycle store", () => {
  it("supports park, ignore, restore, recall, and promotion with code-owned turn stamps", () => {
    const store = new CandidateStore();
    expect(store.upsert(candidate())).toBe("created");
    expect(store.upsert(candidate({ status: "parked", lastTouchedTurn: 2 }))).toBe("updated");
    expect(store.transition("c1", "ignored", 3)).toBe(true);
    expect(store.upsert(candidate({ lastTouchedTurn: 4 }))).toBe("blocked_status");
    expect(store.transition("c1", "parked", 5)).toBe(true);
    expect(store.markRecalled("c1", 6)).toBe(true);
    expect(store.get("c1")).toMatchObject({ status: "parked", createdTurn: 1, lastTouchedTurn: 6, lastRecalledTurn: 6 });
    expect(store.transition("c1", "promoted", 7)).toBe(true);
    expect(store.markRecalled("c1", 8)).toBe(false);
    expect(store.get("c1")).toMatchObject({ status: "promoted", promotedAtTurn: 7 });
  });

  it("blocks reused ids, exact ignored evidence tombstones, and target mutation", () => {
    const store = new CandidateStore();
    store.setLegacyIgnoredIds(["legacy"]);
    expect(store.upsert(candidate({ id: "legacy" }))).toBe("blocked_id");
    expect(store.upsert(candidate())).toBe("created");
    expect(store.transition("c1", "ignored", 2)).toBe(true);
    expect(store.upsert(candidate({ id: "c2", status: "parked", lastTouchedTurn: 3 }))).toBe("blocked_tombstone");
    expect(store.upsert(candidate({ id: "c3", evidenceUtteranceIds: ["u1", "u2"], lastTouchedTurn: 3 }))).toBe("created");
    expect(store.upsert(candidate({ id: "c3", target: "connection", evidenceUtteranceIds: ["u2"], lastTouchedTurn: 4 }))).toBe("target_mismatch");
  });
});
