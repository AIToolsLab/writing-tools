/**
 * M1a -- headless loop tests with a deterministic mock LLM.
 *
 * Nothing in this file hits a network. All LLM turns are hand-crafted to
 * exercise the controller's enforcement logic, not LLM behavior itself.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, withQuestionIntentBias, type MindmapConfig } from "./config";
import { createState, MIRROR_PREAMBLE, processTurn } from "./controller";
import type { LLMContext, LLMTurn } from "./llm-contract";
import { resetIdCounter } from "./store";
import type { MirrorClaim, MirrorReflection, SourceSpan } from "./types";

beforeEach(() => {
  resetIdCounter();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function questionLLM(question: string) {
  return (_ctx: LLMContext): LLMTurn => ({
    mode: "question",
    text: question,
  });
}

function organizeQuestionLLM(question: string) {
  return (_ctx: LLMContext): LLMTurn => ({
    mode: "question",
    text: question,
    questionIntent: "organize",
    questionStance: "organize",
  });
}

/**
 * Mirror where every claim's text and user phrases are drawn verbatim from
 * the provided userText, so the validator will pass.
 */
function groundedMirrorLLM(userText: string, utteranceId: string) {
  return (_ctx: LLMContext): LLMTurn => {
    const span: SourceSpan = {
      claimText: userText,
      utteranceIds: [utteranceId],
      userPhrase: userText,
    };
    const claim: MirrorClaim = {
      id: "c1",
      text: userText,
      candidateId: "cand1",
      target: "idea",
      sourceSpans: [span],
    };
    const mirror: MirrorReflection = { claims: [claim] };
    return {
      mode: "mirror",
      text: "Here is what I heard:",
      mirror,
      // Upsert the candidate so readiness gate finds it in the store.
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: userText, addEvidenceIds: [utteranceId] },
      ],
    };
  };
}

/**
 * Returns a cfg with all readiness thresholds zeroed out so tests that focus
 * on validation or pacing don't also have to satisfy readiness.
 */
function noReadinessCfg(extra?: Partial<MindmapConfig["pacing"]>): MindmapConfig {
  return {
    ...defaultConfig,
    readiness: {
      ...defaultConfig.readiness,
      sourceDensityMin: 0,
      relationClarityMin: 0,
      unsupportedRiskMax: 1,
    },
    pacing: {
      ...defaultConfig.pacing,
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 1,
      ...extra,
    },
  };
}

/**
 * Mirror that injects words not in the source bank — should fail lexical
 * grounding and route to clarify.
 */
function driftingMirrorLLM(utteranceId: string) {
  return (_ctx: LLMContext): LLMTurn => {
    const userPhrase = "running fast";
    const span: SourceSpan = {
      claimText: "running fast is fundamentally central to the experience",
      utteranceIds: [utteranceId],
      userPhrase,
    };
    const claim: MirrorClaim = {
      id: "c1",
      // "fundamentally" and "central" are not in the user's words
      text: "running fast is fundamentally central to the experience",
      candidateId: "cand1",
      target: "idea",
      sourceSpans: [span],
    };
    return {
      mode: "mirror",
      text: "Here is what I heard:",
      mirror: { claims: [claim] },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "running fast", addEvidenceIds: [utteranceId] },
      ],
    };
  };
}

// ---------------------------------------------------------------------------
// Basic question loop
// ---------------------------------------------------------------------------

describe("question mode", () => {
  it("returns question text and stays in question mode", async () => {
    const state = createState();
    const out = await processTurn(state, "I like writing", questionLLM("What do you like about it?"));
    expect(out.mode).toBe("question");
    expect(out.text).toBe("What do you like about it?");
  });

  it("breaks a verbatim-repeat loop with a de-escalating question", async () => {
    const state = createState();
    const repeat = questionLLM("What is the intermediary doing here?");

    const first = await processTurn(state, "the intermediary helps", repeat);
    expect(first.text).toBe("What is the intermediary doing here?");

    // Same model output again — the controller must NOT echo it verbatim.
    const second = await processTurn(state, "I am confused", repeat);
    expect(second.text).not.toBe(first.text);
    expect(state.clarifyTarget).toBeUndefined();
  });

  it("rewrites organize questions that offer inferred structural alternatives", async () => {
    const state = createState();
    const out = await processTurn(
      state,
      "ai should never contribute ideas to the user",
      organizeQuestionLLM(
        'What sits under "ai should never contribute ideas to the user" - the software idea, or the authorship claim?',
      ),
    );

    expect(out.mode).toBe("question");
    expect(out.questionStance).toBe("organize");
    expect(out.text).toBe(
      "How would you describe the relationship between those two thoughts in your own words?",
    );
  });

  it("adds the user utterance to the bank", async () => {
    const state = createState();
    await processTurn(state, "creativity matters", questionLLM("Tell me more."));
    expect(state.bank.getAll()).toHaveLength(1);
    expect(state.bank.getAll()[0].text).toBe("creativity matters");
  });

  it("increments turnsSinceLastMirror", async () => {
    const state = createState();
    await processTurn(state, "first", questionLLM("Q1"));
    expect(state.turnsSinceLastMirror).toBe(1);
    await processTurn(state, "second", questionLLM("Q2"));
    expect(state.turnsSinceLastMirror).toBe(2);
  });

  it("accepts direct create-card map commands alongside a normal question", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human control" },
        },
      ],
    });

    const out = await processTurn(state, "put human control on the map", llm);

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);
  });

  it("trusts LLM placement interpretation for varied create-card phrasing", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human control" },
        },
      ],
    });

    const out = await processTurn(state, "I'd like human control as a card", llm);

    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);
  });

  it("does not execute a create-card command for declarative salience", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What part should we develop first?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human control" },
        },
      ],
    });

    const out = await processTurn(state, "human control is a main idea", llm);

    expect(out.mapCommands).toBeUndefined();
  });

  it("does not execute a create-card command when the text is not an exact current-turn span", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What words should go on the card?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human authorship control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human authorship control" },
        },
      ],
    });

    const out = await processTurn(state, "put human control on the map", llm);

    expect(out.mapCommands).toBeUndefined();
  });

  it("does not execute a create-card command when the cited source id is stale", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_999"], userPhrase: "human control" },
        },
      ],
    });

    const out = await processTurn(state, "drop human control on the canvas", llm);

    expect(out.mapCommands).toBeUndefined();
  });

  it("does not execute a create-card command for referential wording", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What words should go on the card?",
      mapCommands: [
        {
          kind: "create_card",
          text: "my main point",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "my main point" },
        },
      ],
    });

    const out = await processTurn(state, "put my main point on the map", llm);

    expect(out.mapCommands).toBeUndefined();
  });

  it("does not execute a create-card command for expanded referential wording", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What words should go on the card?",
      mapCommands: [
        {
          kind: "create_card",
          text: "that concept",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "that concept" },
        },
      ],
    });

    const out = await processTurn(state, "drop that concept on the canvas", llm);

    expect(out.mapCommands).toBeUndefined();
  });

  it("does not execute future structure commands in the create-card phase", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Which card should it go under?",
      mapCommands: [
        {
          kind: "nest_card",
          childText: "human control",
          parentText: "authorship",
        },
      ],
    });

    const out = await processTurn(state, "put human control under authorship", llm);

    expect(out.mapCommands).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Candidate updates
// ---------------------------------------------------------------------------

describe("candidate updates", () => {
  it("LLM upserts a new candidate into the store", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What about structure?",
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "writing", addEvidenceIds: ["u_1"] },
      ],
    });
    await processTurn(state, "I write daily", llm);
    expect(state.candidates.get("cand1")).toBeDefined();
    expect(state.candidates.get("cand1")?.gist).toBe("writing");
  });

  it("merges evidence when upserting an existing candidate", async () => {
    const state = createState();
    const firstLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "writing", addEvidenceIds: ["u_1"] },
      ],
    });
    const secondLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q2",
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "writing daily", addEvidenceIds: ["u_2"] },
      ],
    });
    await processTurn(state, "writing", firstLLM);
    await processTurn(state, "every day", secondLLM);
    const cand = state.candidates.get("cand1")!;
    expect(cand.evidenceUtteranceIds).toContain("u_1");
    expect(cand.evidenceUtteranceIds).toContain("u_2");
  });

  it("deletes a candidate when the LLM requests it", async () => {
    const state = createState();
    const addLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "x", addEvidenceIds: [] },
      ],
    });
    const deleteLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q2",
      candidateDeletes: ["cand1"],
    });
    await processTurn(state, "first", addLLM);
    await processTurn(state, "second", deleteLLM);
    expect(state.candidates.get("cand1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mirror -- validation pass
// ---------------------------------------------------------------------------

describe("mirror -- validation passes", () => {
  it("returns validatedMirror and resets turnsSinceLastMirror", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 1 });
    const q = await processTurn(state, "running fast is something I do", questionLLM("Tell me more."), cfg);
    expect(q.mode).toBe("question");
    expect(state.turnsSinceLastMirror).toBe(1);

    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "yes exactly", groundedMirrorLLM("running fast is something I do", uid), cfg);
    expect(out.mode).toBe("mirror");
    expect(out.validatedMirror).toBeDefined();
    expect(out.validatedMirror!.claims).toHaveLength(1);
    expect(out.validatedMirror!.claims[0].ok).toBe(true);
    expect(state.turnsSinceLastMirror).toBe(0);
  });

  it("sets state.mode to mirror on pass", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    await processTurn(state, "yes", groundedMirrorLLM("running fast", uid), cfg);
    expect(state.mode).toBe("mirror");
  });
});

// ---------------------------------------------------------------------------
// Mirror -- validation fail -> clarify
// ---------------------------------------------------------------------------

describe("mirror -- validation fails -> clarify fallback", () => {
  it("blocks a drifting mirror and switches to clarify mode", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);

    expect(out.mode).toBe("clarify");
    expect(out.blockedClaims).toBeDefined();
    expect(out.blockedClaims!.length).toBeGreaterThan(0);
    expect(state.mode).toBe("clarify");
  });

  it("clarify text references the failing user phrase", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);

    expect(out.text).toContain("running fast");
  });

  it("stores the clarifyTarget on state for the next LLM context", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);

    expect(state.clarifyTarget).toBeDefined();
    expect(state.clarifyTarget?.userPhrase).toBe("running fast");
  });

  it("does not expose validatedMirror when validation fails", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);

    expect(out.validatedMirror).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

describe("pacing", () => {
  it("suppresses mirror when turnsSinceLastMirror is below threshold", async () => {
    const state = createState();
    // Default minQuestionTurnsBetweenMirrors = 3; we have 0 turns so far.
    await processTurn(state, "I enjoy writing", questionLLM("Q"));
    const uid = state.bank.getAll()[0].id;
    // Immediately try a mirror (only 1 turn elapsed, threshold is 3).
    const out = await processTurn(state, "yes", groundedMirrorLLM("I enjoy writing", uid));

    expect(out.mode).toBe("question");
    expect(out.pacingSuppressed).toBe(true);
    expect(out.text).toBe("What part of that feels most important to carry forward on the map?");
    expect(out.text).not.toBe("Here is what I heard:");
  });

  it("does not leak malformed mirror text when a mirror payload is missing", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0 });
    const copiedUserText =
      "AI can help humans with their writing by contributing nothing to users ideas";
    const malformedMirror = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: copiedUserText,
    });

    await processTurn(state, "Trying to visualize ideas in this draft", questionLLM("Q"), cfg);
    const out = await processTurn(state, copiedUserText, malformedMirror, cfg);

    expect(out.mode).toBe("question");
    expect(out.pacingSuppressed).toBe(true);
    expect(out.text).toBe("What part of that feels most important to carry forward on the map?");
  });

  it("does not de-escalate repeated suppressed mirrors away from map building", async () => {
    const state = createState();
    await processTurn(state, "I enjoy writing", questionLLM("Q"));
    const uid = state.bank.getAll()[0].id;

    const first = await processTurn(state, "yes", groundedMirrorLLM("I enjoy writing", uid));
    const second = await processTurn(
      state,
      "the part to carry forward is that writing helps me think",
      groundedMirrorLLM("I enjoy writing", uid),
    );

    expect(first.text).toBe("What part of that feels most important to carry forward on the map?");
    expect(second.text).toBe("What exact wording do you want the map to carry forward from that?");
    expect(second.questionStance).toBe("organize");
  });

  it("allows mirror after enough question turns", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 2 });
    await processTurn(state, "I enjoy writing", questionLLM("Q1"), cfg);
    const uid = state.bank.getAll()[0].id;
    await processTurn(state, "a lot", questionLLM("Q2"), cfg);
    await processTurn(state, "every day", questionLLM("Q3"), cfg);
    // Now at 3 turns -- meets threshold of 2.
    const out = await processTurn(state, "yes", groundedMirrorLLM("I enjoy writing", uid), cfg);
    expect(out.mode).toBe("mirror");
    expect(out.pacingSuppressed).toBeUndefined();
  });

  it("uses batch preference to suppress a lone ready mirror when map pressure is low", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
    });
    await processTurn(state, "I enjoy writing", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;

    const out = await processTurn(state, "yes", groundedMirrorLLM("I enjoy writing", uid), cfg);

    expect(out.mode).toBe("question");
    expect(out.pacingSuppressed).toBe(true);
  });

  it("lets high map pressure mirror a newly-ready candidate after the user's answer", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    await processTurn(state, "I am working through the draft", questionLLM("What part feels live?"), cfg);

    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready to reflect",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "writing clears my head",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "writing clears my head",
                utteranceIds: ["u_2"],
                userPhrase: "writing clears my head",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        {
          id: "cand1",
          target: "idea",
          gist: "writing clears my head",
          addEvidenceIds: ["u_2", "u_3"],
        },
      ],
    });

    const out = await processTurn(state, "writing clears my head. it helps me think.", llm, cfg);

    expect(out.mode).toBe("mirror");
    expect(out.validatedMirror?.reflection.claims[0].text).toBe("writing clears my head");
  });

  it("uses carry-forward intent to mirror one substantive idea without map-pressure coupling", async () => {
    const state = createState();
    await processTurn(state, "setup one", questionLLM("Q1"));
    await processTurn(state, "setup two", questionLLM("Q2"));
    await processTurn(state, "setup three", questionLLM("Q3"));
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "human control decides what enters the draft",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "human control decides what enters the draft",
                utteranceIds: ["u_4"],
                userPhrase: "human control decides what enters the draft",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        {
          id: "cand1",
          target: "idea",
          gist: "human control decides what enters the draft",
          addEvidenceIds: ["u_4"],
        },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(
      state,
      "human control decides what enters the draft",
      llm,
    );

    expect(out.mode).toBe("mirror");
    expect(out.acceleratedCandidateIds).toEqual(["cand1"]);
    expect(out.readinessNotes).toEqual(["accelerated idea density: cand1"]);
    expect(out.validatedMirror).toBeDefined();
  });

  it("does not use carry-forward intent to accelerate hierarchy candidates", async () => {
    const state = createState();
    await processTurn(state, "setup one", questionLLM("Q1"));
    await processTurn(state, "setup two", questionLLM("Q2"));
    await processTurn(state, "setup three", questionLLM("Q3"));
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "human control wording choices",
            candidateId: "cand1",
            target: "hierarchy",
            sourceSpans: [
              {
                claimText: "human control wording choices",
                utteranceIds: ["u_4"],
                userPhrase: "human control wording choices",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        {
          id: "cand1",
          target: "hierarchy",
          gist: "human control wording choices",
          addEvidenceIds: ["u_4"],
        },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "human control wording choices", llm);

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("not_ready");
    expect(out.suppressionDetail).toBe("Hierarchy needs containment language the user offers unprompted.");
  });

  it("does not use carry-forward intent to accelerate connection candidates", async () => {
    const state = createState();
    await processTurn(state, "setup one", questionLLM("Q1"));
    await processTurn(state, "setup two", questionLLM("Q2"));
    await processTurn(state, "setup three", questionLLM("Q3"));
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "human control and wording choices",
            candidateId: "cand1",
            target: "connection",
            sourceSpans: [
              {
                claimText: "human control and wording choices",
                utteranceIds: ["u_4"],
                userPhrase: "human control and wording choices",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        {
          id: "cand1",
          target: "connection",
          gist: "human control and wording choices",
          addEvidenceIds: ["u_4"],
        },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "human control and wording choices", llm);

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("not_ready");
  });

  it("ignores carry-forward intent on non-substantive utterances", async () => {
    const state = createState();
    await processTurn(state, "setup one", questionLLM("Q1"));
    await processTurn(state, "setup two", questionLLM("Q2"));
    await processTurn(state, "setup three", questionLLM("Q3"));
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "yeah",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [{ claimText: "yeah", utteranceIds: ["u_4"], userPhrase: "yeah" }],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "yeah", addEvidenceIds: ["u_4"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "yeah", llm);

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("not_ready");
    expect(out.acceleratedCandidateIds).toBeUndefined();
  });

  it("routes accelerated ideas to clarify when the mirror drifts from user words", async () => {
    const state = createState();
    await processTurn(state, "setup one", questionLLM("Q1"));
    await processTurn(state, "setup two", questionLLM("Q2"));
    await processTurn(state, "setup three", questionLLM("Q3"));
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "human control decides draft wording is fundamentally central to agency",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "human control decides draft wording is fundamentally central to agency",
                utteranceIds: ["u_4"],
                userPhrase: "human control decides draft wording",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "human control decides draft wording", addEvidenceIds: ["u_4"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "human control decides draft wording", llm);

    expect(out.mode).toBe("clarify");
    expect(out.suppressionReason).toBe("validation_failed");
    expect(out.suppressionDetail).toContain("lexical_grounding");
    expect(out.validationDebug?.[0]).toMatchObject({
      claimId: "c1",
      claimText: "human control decides draft wording is fundamentally central to agency",
      sourceSpans: [
        {
          utteranceIds: ["u_4"],
          userPhrase: "human control decides draft wording",
          citedUtterances: [{ id: "u_4", text: "human control decides draft wording" }],
        },
      ],
    });
    expect(out.validationDebug?.[0]?.checks.some((check) => check.check === "lexical_grounding")).toBe(true);
    expect(out.validatedMirror).toBeUndefined();
  });

  it("still blocks a first-turn mirror even at high map pressure", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "too soon",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "writing clears my head",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "writing clears my head",
                utteranceIds: ["u_1"],
                userPhrase: "writing clears my head",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        {
          id: "cand1",
          target: "idea",
          gist: "writing clears my head",
          addEvidenceIds: ["u_1"],
        },
      ],
    });

    const out = await processTurn(state, "writing clears my head", llm, cfg);

    expect(out.mode).toBe("question");
    expect(out.pacingSuppressed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Segmentation -- a big chunk becomes several grounded units
// ---------------------------------------------------------------------------

describe("segmentation of large input", () => {
  it("splits a multi-sentence turn into separate bank units", async () => {
    const state = createState();
    await processTurn(
      state,
      "I love writing. It clears my head. I do it daily.",
      questionLLM("Which of those feels most central?"),
    );
    expect(state.bank.getAll()).toHaveLength(3);
    expect(state.bank.getAll().every((u) => u.turnId === "t_1")).toBe(true);
  });

  it("lets a single rich turn supply multiple distinct evidence units", async () => {
    const state = createState();
    let captured: LLMContext | undefined;
    // Turn 1: rich chunk -> 2 units (u_1, u_2). LLM groups both under one idea.
    const upsertLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "tell me more",
      candidateUpserts: [
        { id: "i1", target: "idea", gist: "writing clears my head", addEvidenceIds: ["u_1", "u_2"] },
      ],
    });
    await processTurn(state, "writing clears my head. it helps me think.", upsertLLM);
    // Idea readiness needs >=2 distinct evidence units -> now satisfied in one turn.
    const cand = state.candidates.get("i1")!;
    expect(cand.evidenceUtteranceIds).toEqual(["u_1", "u_2"]);

    const captureLLM = (ctx: LLMContext): LLMTurn => {
      captured = ctx;
      return { mode: "question", text: "ok" };
    };
    await processTurn(state, "yes", captureLLM);
    expect(captured!.readyCandidateIds).toContain("i1");
  });
});

// ---------------------------------------------------------------------------
// Fix 1 -- readiness signals are code-derived, not LLM-supplied
// ---------------------------------------------------------------------------

describe("readiness gate cannot be gamed by the LLM", () => {
  it("a hierarchy mirror is blocked when the user used NO containment language", async () => {
    const state = createState();
    const cfg = { ...defaultConfig, pacing: { ...defaultConfig.pacing, minQuestionTurnsBetweenMirrors: 0 } };
    // User text has no containment/relation words; the LLM nonetheless declares a
    // hierarchy candidate and tries to mirror it. Code derives zero signals, so
    // the candidate never becomes ready -> mirror is downgraded to a question.
    const uid = "u_1";
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "trying to force a hierarchy",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "writing is the bigger thing over editing",
            candidateId: "h1",
            target: "hierarchy",
            sourceSpans: [
              { claimText: "writing", utteranceIds: [uid], userPhrase: "writing" },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "h1", target: "hierarchy", gist: "writing over editing", addEvidenceIds: [uid] },
      ],
    });
    const out = await processTurn(state, "writing and editing", llm, cfg);
    expect(out.mode).toBe("question");
    expect(out.validatedMirror).toBeUndefined();
    // No code-derived signals attached.
    expect(state.candidates.get("h1")?.relationSignals).toHaveLength(0);
  });

  it("attaches a spontaneous containment signal when the user actually uses one", async () => {
    const state = createState();
    let captured: LLMContext | undefined;
    const llm = (ctx: LLMContext): LLMTurn => {
      captured = ctx;
      return {
        mode: "question",
        text: "tell me more",
        candidateUpserts: [
          { id: "h1", target: "hierarchy", gist: "details inside the bigger idea", addEvidenceIds: ["u_1"] },
        ],
      };
    };
    // "inside" + "bigger" are containment terms; no AI prior turn -> spontaneous.
    await processTurn(state, "the details belong inside the bigger idea", llm);
    const cand = state.candidates.get("h1")!;
    expect(cand.relationSignals.length).toBeGreaterThan(0);
    expect(cand.relationSignals.every((s) => s.spontaneous)).toBe(true);
    expect(captured).toBeDefined();
  });

  it("marks the signal prompted when it echoes the AI's previous question", async () => {
    const state = createState();
    // Turn 1: AI asks a question containing "under".
    await processTurn(state, "i have some ideas", questionLLM("what sits under the main one?"));
    // Turn 2: user echoes "under"; signal should be prompted, not spontaneous.
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "ok",
      candidateUpserts: [
        { id: "h1", target: "hierarchy", gist: "x under y", addEvidenceIds: ["u_2"] },
      ],
    });
    await processTurn(state, "the small bits go under the main idea", llm);
    const cand = state.candidates.get("h1")!;
    const under = cand.relationSignals.find((s) => s.phrase === "under");
    expect(under).toBeDefined();
    expect(under?.spontaneous).toBe(false);
  });

  it("drops evidence ids that don't exist in the bank", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "ok",
      candidateUpserts: [
        { id: "c1", target: "idea", gist: "x", addEvidenceIds: ["u_1", "u_999", "fake"] },
      ],
    });
    await processTurn(state, "real utterance", llm);
    expect(state.candidates.get("c1")?.evidenceUtteranceIds).toEqual(["u_1"]);
  });
});

// ---------------------------------------------------------------------------
// Fix 3 -- mirror output never shows unvalidated LLM prose
// ---------------------------------------------------------------------------

describe("mirror prose is templated, not LLM free text", () => {
  it("a passing mirror returns the fixed preamble, not the LLM's text", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "yes", groundedMirrorLLM("running fast", uid), cfg);
    expect(out.mode).toBe("mirror");
    expect(out.text).toBe(MIRROR_PREAMBLE);
    expect(out.text).not.toBe("Here is what I heard:");
  });
});

// ---------------------------------------------------------------------------
// Fix 4 -- "I'm not sure" forces clarify in code (never mirror, never move on)
// ---------------------------------------------------------------------------

describe("stuck user is forced into clarify", () => {
  it("blocks a mirror when the user says they're not sure", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    // Build a groundable utterance first.
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    // User is stuck this turn, yet the LLM tries to mirror anyway.
    const out = await processTurn(state, "honestly I'm not sure", groundedMirrorLLM("running fast", uid), cfg);
    expect(out.mode).toBe("clarify");
    expect(out.validatedMirror).toBeUndefined();
  });

  it("uses the LLM's question text when it complies with a clarify/question", async () => {
    const state = createState();
    const out = await processTurn(
      state,
      "I don't know where to start",
      questionLLM("What's the one idea you keep coming back to?"),
    );
    expect(out.mode).toBe("clarify");
    expect(out.text).toBe("What's the one idea you keep coming back to?");
  });

  it("falls back to a concrete re-angle when the LLM tries to mirror", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "im stuck", groundedMirrorLLM("running fast", uid), cfg);
    expect(out.mode).toBe("clarify");
    expect(out.text).toContain("surest");
  });
});

// ---------------------------------------------------------------------------
// LLM context forwarding
// ---------------------------------------------------------------------------

describe("LLM context", () => {
  it("passes bank and candidates to the LLM each turn", async () => {
    const state = createState();
    let capturedCtx: LLMContext | undefined;
    const captureLLM = (ctx: LLMContext): LLMTurn => {
      capturedCtx = ctx;
      return { mode: "question", text: "Q" };
    };
    await processTurn(state, "first utterance", questionLLM("Q1"));
    await processTurn(state, "second utterance", captureLLM);
    expect(capturedCtx!.bank).toHaveLength(2);
  });

  it("passes turnsSinceLastMirror in context", async () => {
    const state = createState();
    let seen = -1;
    const captureLLM = (ctx: LLMContext): LLMTurn => {
      seen = ctx.turnsSinceLastMirror;
      return { mode: "question", text: "Q" };
    };
    await processTurn(state, "a", questionLLM("Q1"));
    await processTurn(state, "b", questionLLM("Q2"));
    await processTurn(state, "c", captureLLM);
    expect(seen).toBe(2);
  });

  it("passes clarifyTarget when in clarify mode", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);

    let capturedTarget: SourceSpan | undefined;
    const captureLLM = (ctx: LLMContext): LLMTurn => {
      capturedTarget = ctx.clarifyTarget;
      return { mode: "question", text: "Q" };
    };
    await processTurn(state, "follow-up", captureLLM, cfg);
    expect(capturedTarget?.userPhrase).toBe("running fast");
  });
});
