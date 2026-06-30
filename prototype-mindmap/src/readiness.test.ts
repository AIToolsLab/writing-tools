import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config";
import { evaluateReadiness } from "./readiness";
import type { CandidateThought, RelationSignal, SourceUtterance } from "./types";

function bank(...texts: string[]): SourceUtterance[] {
  return texts.map((text, i) => ({
    id: `u${i + 1}`,
    text,
    timestamp: i,
    origin: "chat" as const,
  }));
}

function sig(phrase: string, utteranceId: string, spontaneous: boolean): RelationSignal {
  return { phrase, utteranceId, spontaneous };
}

describe("readiness signal", () => {
  it("an idea with repeated grounding is ready to mirror", () => {
    const b = bank(
      "the chat is where the thinking happens",
      "the chat is the place i actually think things through",
    );
    const candidate: CandidateThought = {
      id: "cand-idea",
      target: "idea",
      evidenceUtteranceIds: ["u1", "u2"],
      relationSignals: [],
      gist: "the chat is where the thinking happens",
    };
    const r = evaluateReadiness(candidate, b, defaultConfig);
    expect(r.decision).toBe("attempt_mirror");
  });

  it("a topic mentioned only once is not yet ready", () => {
    const b = bank("i guess the visualization matters");
    const candidate: CandidateThought = {
      id: "cand-thin",
      target: "idea",
      evidenceUtteranceIds: ["u1"],
      relationSignals: [],
      gist: "the visualization matters",
    };
    const r = evaluateReadiness(candidate, b, defaultConfig);
    expect(r.decision).toBe("ask_clarifying_question");
  });

  it("a hierarchy from ONLY prompted containment is blocked (hard rule)", () => {
    const b = bank(
      "yeah the details sit under the bigger idea",
      "the details are under that idea i suppose",
    );
    const candidate: CandidateThought = {
      id: "cand-hier",
      target: "hierarchy",
      evidenceUtteranceIds: ["u1", "u2"],
      // Both signals echoed the AI's question ("what sits under...?") => prompted.
      relationSignals: [sig("under", "u1", false), sig("under", "u2", false)],
      gist: "the details sit under the bigger idea",
    };
    const r = evaluateReadiness(candidate, b, defaultConfig);
    expect(r.decision).toBe("ask_clarifying_question");
    expect(r.reason).toMatch(/unprompted/i);
  });

  it("a hierarchy with spontaneous containment + grounding is ready", () => {
    const b = bank(
      "the small details belong inside the bigger structure",
      "those details are part of the structure for sure",
    );
    const candidate: CandidateThought = {
      id: "cand-hier2",
      target: "hierarchy",
      evidenceUtteranceIds: ["u1", "u2"],
      relationSignals: [sig("inside", "u1", true), sig("part of", "u2", true)],
      gist: "the details belong inside the bigger structure",
    };
    const r = evaluateReadiness(candidate, b, defaultConfig);
    expect(r.decision).toBe("attempt_mirror");
  });

  it("flags high unsupported risk when the gist drifts from user words", () => {
    const b = bank("um i dunno the thing with the stuff");
    const candidate: CandidateThought = {
      id: "cand-drift",
      target: "idea",
      evidenceUtteranceIds: ["u1", "u1"],
      relationSignals: [],
      // Gist is the AI's paraphrase using words the user never said.
      gist: "epistemological scaffolding enables metacognitive externalization",
    };
    const r = evaluateReadiness(candidate, b, defaultConfig);
    expect(r.decision).toBe("ask_clarifying_question");
    expect(r.unsupportedRisk).toBeGreaterThan(defaultConfig.readiness.unsupportedRiskMax);
  });
});
