/**
 * Coach Trace derive-layer tests.
 *
 * The completeness suite is the forcing function: every command reason the
 * controller can emit must map to a real catalog entry, and every typed union
 * (suppression, stance, confirmation kind) is compile-enforced in trace.ts. If
 * the controller grows a new command reason, re-harvest it (grep `reason:` in
 * controller.ts) into COMMAND_STORY or these tests fail.
 */

import { describe, expect, it } from "vitest";
import type { TurnOutput } from "./controller";
import { deriveTraceEvent, KNOWN_COMMAND_REASONS, type TraceLevel } from "./trace";

function out(partial: Partial<TurnOutput>): TurnOutput {
  return {
    mode: "question",
    text: "coach text",
    llmTurn: { mode: "question", text: "coach text" },
    ...partial,
  };
}

const LEVELS: TraceLevel[] = ["quiet", "notice", "held"];

describe("catalog completeness", () => {
  it("maps every known command reason to a real, non-fallback catalog entry", () => {
    for (const reason of KNOWN_COMMAND_REASONS) {
      const ev = deriveTraceEvent(out({ commandDebug: [{ reason, detail: "d" }] }), "t");
      // Recognized as the dominant reason (not silently degraded to a stance).
      expect(ev.reason).toBe(reason);
      expect(ev.title.length).toBeGreaterThan(0);
      expect(ev.explanation.length).toBeGreaterThan(0);
      expect(LEVELS).toContain(ev.level);
      expect(ev.icon.length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the 40 harvested command reasons (re-harvest controller.ts if this changes)", () => {
    expect(KNOWN_COMMAND_REASONS.length).toBe(40);
  });
});

describe("dominant-reason precedence", () => {
  it("executed command wins over everything", () => {
    const ev = deriveTraceEvent(
      out({
        mode: "question",
        suppressionReason: "command_precedence",
        mapCommands: [{ kind: "create_card", text: "x", sourceUtteranceIds: ["u_1"] }],
      }),
      "t",
    );
    expect(ev.reason).toBe("executed");
    expect(ev.level).toBe("notice");
    expect(ev.title).toBe("Followed your instruction");
  });

  it("a pending confirmation maps by its kind", () => {
    const ev = deriveTraceEvent(
      out({
        commandConfirmation: {
          kind: "reference_confirmation",
          prompt: "Did you mean that one?",
          command: { kind: "create_card", text: "x", sourceUtteranceIds: ["u_1"] },
          debug: "near_match_pending",
        },
      }),
      "t",
    );
    expect(ev.reason).toBe("pending:reference_confirmation");
    expect(ev.title).toBe("Checked which card you meant");
  });

  it("a shown mirror reads as reflected", () => {
    const ev = deriveTraceEvent(out({ mode: "mirror", text: "Here's the structure…" }), "t");
    expect(ev.reason).toBe("mirror");
    expect(ev.level).toBe("notice");
  });

  it("a plain question is quiet and keyed to its stance", () => {
    const ev = deriveTraceEvent(out({ mode: "question", questionStance: "organize" }), "t");
    expect(ev.reason).toBe("stance:organize");
    expect(ev.level).toBe("quiet");
    expect(ev.title).toBe("Looking at how things relate");
  });

  it("coverage/focus-help reasons surface as offered directions", () => {
    const ev = deriveTraceEvent(out({ commandDebug: [{ reason: "coverage_intent", detail: "d" }] }), "t");
    expect(ev.title).toBe("Offered some directions");
    expect(ev.level).toBe("notice");
  });

  it("an unknown command reason degrades to the stance rather than inventing copy", () => {
    const ev = deriveTraceEvent(
      out({ questionStance: "settle", commandDebug: [{ reason: "some_future_reason", detail: "d" }] }),
      "t",
    );
    expect(ev.reason).toBe("stance:settle");
    expect(ev.level).toBe("quiet");
  });
});

describe("held-back reflection", () => {
  it("is calm, system-subject, and exposes only the numeric score", () => {
    const ev = deriveTraceEvent(
      out({
        mode: "clarify",
        suppressionReason: "validation_failed",
        validationDebug: [
          {
            claimId: "c1",
            claimText: "assembled model claim",
            target: "idea",
            message: "m",
            checks: [{ check: "lexical_grounding", ok: false, score: 0.62, threshold: 0.75 }],
            sourceSpans: [],
          },
        ],
      }),
      "t",
    );
    expect(ev.level).toBe("held");
    expect(ev.title).toBe("I held back a reflection");
    expect(ev.detail).toContain("0.62");
    expect(ev.detail).toContain("0.75");
    expect(ev.technical?.score).toBe(0.62);
  });
});

describe("no model-generated prose leaks", () => {
  it("never surfaces out.text, claim text, or free-form suppressionDetail", () => {
    const ev = deriveTraceEvent(
      out({
        mode: "clarify",
        text: "MODEL_QUESTION_TEXT",
        suppressionReason: "validation_failed",
        suppressionDetail: "multiple focused claims: SNEAKY_MODEL_PROSE",
        validationDebug: [
          {
            claimId: "c1",
            claimText: "SNEAKY_MODEL_PROSE",
            target: "idea",
            message: "SNEAKY_MODEL_PROSE",
            checks: [{ check: "lexical_grounding", ok: false, score: 0.4, threshold: 0.75 }],
            sourceSpans: [],
          },
        ],
      }),
      "t",
    );
    const surfaced = JSON.stringify(ev);
    expect(surfaced).not.toContain("SNEAKY_MODEL_PROSE");
    expect(surfaced).not.toContain("MODEL_QUESTION_TEXT");
  });
});
