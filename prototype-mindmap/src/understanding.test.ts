import { describe, expect, it } from "vitest";

import { defaultConfig } from "./config";
import type { TurnOutput } from "./controller";
import { SourceBank } from "./store";
import type { CandidateThought, ReadinessSignal } from "./types";
import { buildUnderstanding } from "./understanding";

function out(partial: Partial<TurnOutput> = {}): TurnOutput {
  return {
    mode: "question",
    text: "coach text",
    llmTurn: { mode: "question", text: "coach text" },
    ...partial,
  };
}

describe("buildUnderstanding", () => {
  it("labels tracked ideas from user source wording, never candidate gist", () => {
    const bank = new SourceBank();
    const source = bank.add("human control decides what enters the final draft");
    const candidate: CandidateThought = {
      id: "candidate_secret",
      target: "idea",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "AI-generated ownership mechanism",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "idea",
      sourceDensity: 1,
      relationClarity: 1,
      unsupportedRisk: 0,
      decision: "attempt_mirror",
      reason: "Ready to mirror.",
    };

    const snapshot = buildUnderstanding({
      out: out(),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    expect(snapshot.trackedIdeas).toHaveLength(1);
    expect(snapshot.trackedIdeas[0].label).toContain("human control");
    expect(snapshot.trackedIdeas[0].label).not.toContain("AI-generated");
    expect(snapshot.trackedIdeas[0].status).toBe("ready");
  });

  it("strips a coaching/command lead-in from the displayed idea label", () => {
    const bank = new SourceBank();
    const source = bank.add(
      "Please help me carry forward the main idea: control means the human decides",
    );
    const candidate: CandidateThought = {
      id: "candidate_control",
      target: "idea",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "control gist",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "idea",
      sourceDensity: 1,
      relationClarity: 1,
      unsupportedRisk: 0,
      decision: "attempt_mirror",
      reason: "Ready to mirror.",
    };

    const snapshot = buildUnderstanding({
      out: out(),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    const label = snapshot.trackedIdeas[0].label;
    expect(label.startsWith("control means")).toBe(true);
    expect(label.toLowerCase()).not.toContain("carry forward");
    expect(label.toLowerCase()).not.toContain("main idea");
    expect(label.toLowerCase()).not.toContain("please");
  });

  it("does not strip an ordinary colon in the user's own wording", () => {
    const bank = new SourceBank();
    const source = bank.add("control means: the human decides what enters");
    const candidate: CandidateThought = {
      id: "candidate_plain_colon",
      target: "idea",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "gist",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "idea",
      sourceDensity: 1,
      relationClarity: 1,
      unsupportedRisk: 0,
      decision: "attempt_mirror",
      reason: "Ready to mirror.",
    };

    const snapshot = buildUnderstanding({
      out: out(),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    expect(snapshot.trackedIdeas[0].label).toContain("control means:");
  });

  it("keeps free-form suppression detail out of user-facing safety copy", () => {
    const bank = new SourceBank();
    const snapshot = buildUnderstanding({
      out: out({
        suppressionReason: "mirror_pressure_bridge",
        suppressionDetail: "readyCandidateIds=secret_1; threshold=2; turnsSinceLastMirror=4",
      }),
      candidates: [],
      readiness: [],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    const visible = JSON.stringify({
      latest: {
        title: snapshot.latest.title,
        explanation: snapshot.latest.explanation,
        detail: snapshot.latest.detail,
      },
      safetyChecks: snapshot.safetyChecks,
      activeEvents: snapshot.activeEvents,
      waitingFor: snapshot.waitingFor,
      draftAnchors: snapshot.draftAnchors,
    });
    expect(visible).not.toContain("secret_1");
    expect(visible).not.toContain("readyCandidateIds");
  });

  it("turns an accepted map command into turn-specific events with user evidence", () => {
    const bank = new SourceBank();
    const source = bank.add("make a card for user control over the mind map");
    const snapshot = buildUnderstanding({
      out: out({
        mapCommands: [
          {
            kind: "create_card",
            text: "user control over the mind map",
            sourceUtteranceIds: [source.id],
          },
        ],
      }),
      candidates: [],
      readiness: [],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    expect(snapshot.activeEvents.map((event) => event.title)).toEqual([
      "Map instruction detected",
      "Map write limited",
    ]);
    expect(snapshot.activeEvents[0].evidence).toContain("make a card");
    expect(JSON.stringify(snapshot.activeEvents)).not.toContain("Reading your words");
  });

  it("surfaces mirror pressure as a readiness event without raw ids", () => {
    const bank = new SourceBank();
    const source = bank.add("control means the user makes every key decision");
    const candidate: CandidateThought = {
      id: "candidate_secret",
      target: "idea",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "AI-generated control theory",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "idea",
      sourceDensity: 1,
      relationClarity: 1,
      unsupportedRisk: 0,
      decision: "attempt_mirror",
      reason: "Ready to mirror.",
    };

    const snapshot = buildUnderstanding({
      out: out({
        suppressionReason: "mirror_pressure_bridge",
        suppressionDetail: "readyCandidateIds=candidate_secret; threshold=2; turnsSinceLastMirror=5",
      }),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    expect(snapshot.activeEvents[0].title).toBe("Ready to reflect");
    expect(snapshot.activeEvents[0].evidence).toContain("control means");
    expect(JSON.stringify(snapshot.activeEvents)).not.toContain("candidate_secret");
    expect(JSON.stringify(snapshot.activeEvents)).not.toContain("AI-generated");
  });

  it("does not invent a full fixed checklist for an ordinary question turn", () => {
    const bank = new SourceBank();
    const snapshot = buildUnderstanding({
      out: out({ questionStance: "deepen" }),
      candidates: [],
      readiness: [],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    expect(snapshot.activeEvents).toHaveLength(1);
    expect(snapshot.activeEvents[0].title).toBe("Question chosen");
  });

  it("does not add draft/readiness filler events on unrelated question turns", () => {
    const bank = new SourceBank();
    const source = bank.add("control means deciding every key decision");
    const candidate: CandidateThought = {
      id: "candidate_1",
      target: "idea",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "control means deciding every key decision",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "idea",
      sourceDensity: 1,
      relationClarity: 1,
      unsupportedRisk: 0,
      decision: "attempt_mirror",
      reason: "Ready to mirror.",
    };

    const snapshot = buildUnderstanding({
      out: out({ questionStance: "deepen" }),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [
        {
          kind: "main_idea",
          text: "human authorship",
          userPhrase: "The main idea is human authorship",
          start: 0,
          end: 34,
        },
      ],
      config: defaultConfig,
    });

    expect(snapshot.trackedIdeas[0].status).toBe("ready");
    expect(snapshot.draftAnchors).toHaveLength(1);
    expect(snapshot.activeEvents).toHaveLength(1);
    expect(snapshot.activeEvents[0].title).toBe("Question chosen");
  });

  it("labels density as the blocker before relationship clarity", () => {
    const bank = new SourceBank();
    const source = bank.add("control under authorship");
    const candidate: CandidateThought = {
      id: "candidate_1",
      target: "connection",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "control under authorship",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "connection",
      sourceDensity: 0.2,
      relationClarity: 0,
      unsupportedRisk: 0,
      decision: "ask_clarifying_question",
      reason: "Not enough repeated user grounding yet.",
    };

    const snapshot = buildUnderstanding({
      out: out(),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      config: defaultConfig,
    });

    expect(snapshot.trackedIdeas[0].status).toBe("too_early");
  });
});
