import { describe, expect, it } from "vitest";
import { detectSignals, targetForSignals } from "./signals";

describe("structural-signal detection", () => {
  it("detects spontaneous containment language", () => {
    const signals = detectSignals(
      "u1",
      "the small parts belong inside the bigger idea",
      "what else can you tell me about this?",
    );
    const containment = signals.find((s) => s.kind === "containment");
    expect(containment).toBeDefined();
    expect(containment?.spontaneous).toBe(true);
    expect(targetForSignals(signals)).toBe("hierarchy");
  });

  it("marks containment as prompted when the AI used the term first", () => {
    const signals = detectSignals(
      "u2",
      "yeah it sits under that one",
      "what sits under the bigger idea?",
    );
    const under = signals.find((s) => s.term === "under");
    expect(under).toBeDefined();
    expect(under?.spontaneous).toBe(false);
  });

  it("detects relation language and classifies as connection", () => {
    const signals = detectSignals("u3", "the questioning leads to the visualization");
    expect(signals.some((s) => s.kind === "relation")).toBe(true);
    expect(targetForSignals(signals)).toBe("connection");
  });

  it("matches whole words only (under, not thunder)", () => {
    const signals = detectSignals("u4", "the thunder was loud last night");
    expect(signals.length).toBe(0);
  });

  it("returns no signals for a plain topic mention", () => {
    const signals = detectSignals("u5", "i want to write about my summer");
    expect(signals.length).toBe(0);
    expect(targetForSignals(signals)).toBe("idea");
  });
});
