import { describe, expect, it } from "vitest";

import { resolveMirrorDecision } from "./App";

describe("resolveMirrorDecision", () => {
  it("waits to continue until every claim in the mirror is confirmed", () => {
    const first = resolveMirrorDecision(
      {
        c1: "pending",
        c2: "pending",
      },
      "c1",
      "confirmed",
    );

    expect(first.allDecided).toBe(false);
    expect(first.shouldContinue).toBe(false);

    const second = resolveMirrorDecision(first.nextDecisions, "c2", "confirmed");

    expect(second.allDecided).toBe(true);
    expect(second.anyConfirmed).toBe(true);
    expect(second.anyDeclined).toBe(false);
    expect(second.shouldContinue).toBe(true);
  });

  it("prefers the repair path when any chunk in a completed mirror is declined", () => {
    const first = resolveMirrorDecision(
      {
        c1: "pending",
        c2: "pending",
      },
      "c1",
      "confirmed",
    );

    const second = resolveMirrorDecision(first.nextDecisions, "c2", "declined");

    expect(second.allDecided).toBe(true);
    expect(second.anyConfirmed).toBe(true);
    expect(second.anyDeclined).toBe(true);
    expect(second.shouldContinue).toBe(false);
  });
});
