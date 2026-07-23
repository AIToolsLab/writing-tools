import { describe, expect, it, vi } from "vitest";
import {
  MUTATION_INTENTS,
  createMutationAccess,
  inspectMutation,
} from "./mutation-policy";

describe("mutation policy", () => {
  it("permits every declared user mutation in authoring mode", () => {
    const access = createMutationAccess("authoring");
    for (const intent of MUTATION_INTENTS) {
      expect(inspectMutation("authoring", intent)).toBeNull();
      expect(access.allows(intent)).toBe(true);
    }
  });

  it("rejects every declared user mutation before its callback in translated view", () => {
    const access = createMutationAccess("translated_view");
    const mutation = vi.fn();
    for (const intent of MUTATION_INTENTS) {
      expect(access.run(intent, mutation)).toEqual({
        status: "rejected",
        reason: "read_only_view",
        intent,
      });
    }
    expect(mutation).not.toHaveBeenCalled();
  });

  it("returns the authoring mutation result", () => {
    const access = createMutationAccess("authoring");
    expect(access.run("canvas_edit", () => "changed")).toEqual({
      status: "applied",
      value: "changed",
    });
  });
});
