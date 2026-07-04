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

    expect(snapshot.activeEvents[0].title).toBe("Reflection may be close");
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

  it("turns a too-early deepen turn into a causal path", () => {
    const bank = new SourceBank();
    const source = bank.add("control means making key decisions");
    const candidate: CandidateThought = {
      id: "candidate_secret",
      target: "idea",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "AI-generated gist",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "idea",
      sourceDensity: 0.2,
      relationClarity: 1,
      unsupportedRisk: 0,
      decision: "ask_clarifying_question",
      reason: "Not enough repeated user grounding yet.",
    };

    const snapshot = buildUnderstanding({
      out: out({ questionStance: "deepen" }),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      turnShape: { kind: "compact", reasons: [], selected: false },
      questionStance: "deepen",
      config: defaultConfig,
    });

    expect(snapshot.activeEvents.map((event) => event.stage)).toEqual(["tracked", "checked", "chosen"]);
    expect(snapshot.activeEvents.map((event) => event.title)).toEqual([
      "Idea being tracked",
      "Grounding still thin",
      "Deepening chosen",
    ]);
    expect(JSON.stringify(snapshot.activeEvents)).not.toContain("candidate_secret");
    expect(JSON.stringify(snapshot.activeEvents)).not.toContain("AI-generated");
  });

  it("explains missing relationship before a follow-up question", () => {
    const bank = new SourceBank();
    const source = bank.add("control sits under authorship");
    const candidate: CandidateThought = {
      id: "candidate_secret",
      target: "connection",
      evidenceUtteranceIds: [source.id],
      relationSignals: [],
      gist: "AI relationship gist",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "connection",
      sourceDensity: 1,
      relationClarity: 0,
      unsupportedRisk: 0,
      decision: "ask_clarifying_question",
      reason: "Needs relationship clarity.",
    };

    const snapshot = buildUnderstanding({
      out: out({ questionStance: "narrow" }),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      questionStance: "narrow",
      config: defaultConfig,
    });

    expect(snapshot.activeEvents.map((event) => event.title)).toContain("Relationship still missing");
    expect(snapshot.activeEvents[snapshot.activeEvents.length - 1]?.title).toBe("Narrowing chosen");
  });

  it("shows read-only map context when a map-aware question is chosen", () => {
    const bank = new SourceBank();
    const snapshot = buildUnderstanding({
      out: out({ questionStance: "organize" }),
      candidates: [],
      readiness: [],
      bank,
      draftDeclarations: [],
      mapQuestionContext: [
        { ref: "#86", text: "monitoring", neighbors: [{ ref: "#166", text: "control" }] },
      ],
      mapIsSparse: false,
      questionStance: "organize",
      config: { ...defaultConfig, pacing: { ...defaultConfig.pacing, mapPressure: 1 } },
    });

    expect(snapshot.activeEvents.map((event) => event.title)).toEqual([
      "Map context available",
      "Map write guard checked",
      "Map-aware question chosen",
    ]);
    expect(snapshot.activeEvents[0].evidence).toContain("#86");
    expect(snapshot.activeEvents[1].technicalDetail).toContain("mapCommands:0");
  });

  it("shows answer transition and stale re-ask guard when the user answered", () => {
    const bank = new SourceBank();
    const snapshot = buildUnderstanding({
      out: out({ questionStance: "deepen" }),
      candidates: [],
      readiness: [],
      bank,
      draftDeclarations: [],
      userAnsweredLastQuestion: true,
      questionStance: "deepen",
      config: defaultConfig,
    });

    expect(snapshot.activeEvents.map((event) => event.title)).toEqual([
      "Answer received",
      "Stale re-ask avoided",
      "Deepening chosen",
    ]);
  });

  it("keeps the chosen step visible when many causal details exist", () => {
    const bank = new SourceBank();
    const source = bank.add("control depends on monitoring because users decide");
    const candidate: CandidateThought = {
      id: "candidate_secret",
      target: "connection",
      evidenceUtteranceIds: [source.id],
      relationSignals: [{ phrase: "depends on", utteranceId: source.id, spontaneous: true }],
      gist: "AI relationship gist",
    };
    const readiness: ReadinessSignal = {
      candidateId: candidate.id,
      target: "connection",
      sourceDensity: 0.3,
      relationClarity: 0,
      unsupportedRisk: 0,
      decision: "ask_clarifying_question",
      reason: "Needs relationship clarity.",
    };

    const snapshot = buildUnderstanding({
      out: out({ questionStance: "organize" }),
      candidates: [candidate],
      readiness: [readiness],
      bank,
      draftDeclarations: [],
      userAnsweredLastQuestion: true,
      detectedSignals: [
        { phrase: "depends on", utteranceId: source.id, spontaneous: true, kind: "relation", term: "depends on" },
      ],
      mapQuestionContext: [{ ref: "#86", text: "monitoring", neighbors: [] }],
      mapIsSparse: false,
      questionStance: "organize",
      config: { ...defaultConfig, pacing: { ...defaultConfig.pacing, mapPressure: 1 } },
    });

    expect(snapshot.activeEvents).toHaveLength(5);
    expect(snapshot.activeEvents[snapshot.activeEvents.length - 1]?.stage).toBe("chosen");
    expect(snapshot.activeEvents[snapshot.activeEvents.length - 1]?.title).toBe("Map-aware question chosen");
  });

  it("shows attempted then held for a failed mirror validation", () => {
    const bank = new SourceBank();
    const source = bank.add("control means user decisions");
    const snapshot = buildUnderstanding({
      out: out({
        suppressionReason: "validation_failed",
        suppressionDetail: "raw debug should not show",
        validationDebug: [
          {
            claimId: "claim_secret",
            claimText: "AI-generated claim",
            target: "idea",
            message: "failed",
            checks: [
              {
                check: "lexical_grounding",
                ok: false,
                score: 0.2,
                threshold: 0.75,
              },
            ],
            sourceSpans: [
              {
                claimText: "AI-generated claim",
                userPhrase: "control means user decisions",
                utteranceIds: [source.id],
                citedUtterances: [{ id: source.id, text: source.text }],
              },
            ],
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
      "Reflection attempted",
      "Reflection held back",
    ]);
    const visible = JSON.stringify(snapshot.activeEvents);
    expect(visible).toContain("control means user decisions");
    expect(visible).not.toContain("raw debug should not show");
    expect(visible).not.toContain("claim_secret");
    expect(visible).not.toContain("AI-generated");
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
