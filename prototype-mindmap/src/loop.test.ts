/**
 * M1a -- headless loop tests with a deterministic mock LLM.
 *
 * Nothing in this file hits a network. All LLM turns are hand-crafted to
 * exercise the controller's enforcement logic, not LLM behavior itself.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, withQuestionIntentBias, type MindmapConfig } from "./config";
import { createState, MIRROR_PREAMBLE, processTurn, type PendingMapCommand } from "./controller";
import type { LLMContext, LLMMapContext, LLMTurn } from "./llm-contract";
import { resetIdCounter } from "./store";
import type { MirrorClaim, MirrorReflection, SourceSpan, ThoughtUnit } from "./types";

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

function deepenLLM(question: string) {
  return (_ctx: LLMContext): LLMTurn => ({
    mode: "question",
    text: question,
    questionStance: "deepen",
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

function mirrorPressureQuestionLLM(question = "What does control actually mean here?") {
  return (ctx: LLMContext): LLMTurn => {
    const latest = ctx.bank.slice(-2);
    return {
      mode: "question",
      text: question,
      questionStance: "deepen",
      candidateUpserts: latest.map((unit, index) => ({
        id: `ready_${index + 1}`,
        target: "idea",
        gist: unit.text,
        addEvidenceIds: [unit.id],
      })),
    };
  };
}

function mirrorPressureClarifyLLM(question = "What wording should change here?") {
  return (ctx: LLMContext): LLMTurn => {
    const latest = ctx.bank.slice(-2);
    return {
      mode: "clarify",
      text: question,
      questionStance: "narrow",
      candidateUpserts: latest.map((unit, index) => ({
        id: `ready_${index + 1}`,
        target: "idea",
        gist: unit.text,
        addEvidenceIds: [unit.id],
      })),
    };
  };
}

function mapUnit(id: string, text: string): ThoughtUnit {
  return {
    id,
    text,
    role: "node",
    source: { utteranceIds: [`u_${id}`], createdBy: "user" },
    roleHistory: [{ role: "node", changedBy: "user", at: 1 }],
  };
}

function nestedMapUnit(id: string, text: string, parentId: string): ThoughtUnit {
  return {
    ...mapUnit(id, text),
    role: "content",
    parentId,
    roleHistory: [{ role: "content", changedBy: "user", at: 1 }],
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

    const out = await processTurn(state, "I'd like human control as a card", llm);

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);
  });

  it("recognizes exact create-card commands when the LLM stays in question mode", async () => {
    const state = createState();
    const llm = questionLLM("some coach question the command should override");

    await processTurn(
      state,
      "I don't want to make a card yet.",
      questionLLM("What exact wording do you want to carry forward as the next card?"),
    );

    const out = await processTurn(
      state,
      "Okay, now make a card with this exact text: AI becomes risky when it makes choices that should belong to the writer.",
      llm,
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "AI becomes risky when it makes choices that should belong to the writer.",
        sourceUtteranceIds: ["u_2"],
      },
    ]);
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it.each([
    [
      "Create a card with exactly this text: AI becomes risky when it makes choices that should belong to the writer.",
      "AI becomes risky when it makes choices that should belong to the writer.",
    ],
    [
      "Create a card for this, AI becomes risky when it makes choices that should belong to the writer.",
      "AI becomes risky when it makes choices that should belong to the writer.",
    ],
    ["Put No AI words on the map", "No AI words"],
    ["Turn No AI words into a card", "No AI words"],
  ])("deterministically accepts explicit create-card phrasing: %s", async (userText, expectedText) => {
    const state = createState();

    const out = await processTurn(
      state,
      userText,
      questionLLM("some coach question the command should override"),
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: expectedText, sourceUtteranceIds: ["u_1"] },
    ]);
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it.each([
    "Okay, put human control on the map",
    "Now add human control to the map",
    "Let's put human control on the map",
    "Alright, drop human control on the canvas",
  ])("still accepts natural imperative placement after a filler lead-in: %s", async (userText) => {
    const state = createState();

    const out = await processTurn(
      state,
      userText,
      questionLLM("some coach question the command should override"),
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it.each([
    "I already put human control on the map earlier.",
    "This made me want to turn my anger into a card game.",
    "I keep meaning to put human control on the map.",
  ])("does not mint a card when a placement phrase is embedded in prose: %s", async (userText) => {
    const state = createState();

    const out = await processTurn(
      state,
      userText,
      questionLLM("What part of that feels most alive right now?"),
    );

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toBeUndefined();
  });

  it("asks rather than executes when a placement is phrased as an uncertain question", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Can you put human control on the map?",
      questionLLM("What exact words should go on that card?"),
    );

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toBeUndefined();
  });

  it.each([
    "Create a card with exactly this text: AI is risky. It removes agency.",
    "Okay, now make a card with this exact text: AI is risky. It removes agency.",
  ])("keeps a full multi-sentence exact-text payload across segmentation: %s", async (userText) => {
    const state = createState();

    const out = await processTurn(
      state,
      userText,
      questionLLM("some coach question the command should override"),
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "AI is risky. It removes agency.",
        sourceUtteranceIds: ["u_1", "u_2"],
      },
    ]);
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it("does not pull draft text into a multi-segment exact-text card", async () => {
    const state = createState();
    state.draft = "The draft says agency matters. And control matters too.";

    const out = await processTurn(
      state,
      "Create a card with exactly this text: AI is risky. It removes agency.",
      questionLLM("q"),
      defaultConfig,
      "chat",
      { thoughtUnits: [], connections: [] },
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "AI is risky. It removes agency.",
        sourceUtteranceIds: ["u_1", "u_2"],
      },
    ]);
  });

  it("does not pull a prior turn's sentence into a multi-segment exact-text card", async () => {
    const state = createState();
    await processTurn(state, "I was thinking about authorship earlier.", questionLLM("q"));

    const out = await processTurn(
      state,
      "Create a card with exactly this text: AI is risky. It removes agency.",
      questionLLM("q2"),
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "AI is risky. It removes agency.",
        sourceUtteranceIds: ["u_2", "u_3"],
      },
    ]);
  });

  it("still blocks a referential/anaphoric payload even in exact-text form", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Create a card with exactly this text: that idea. It matters.",
      questionLLM("What exact words should go on the card?"),
    );

    expect(out.mapCommands).toBeUndefined();
  });

  it("leaves single-segment exact-text commands on the existing per-unit path", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Create a card with exactly this text: AI becomes risky when it makes choices.",
      questionLLM("some coach question the command should override"),
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "AI becomes risky when it makes choices.",
        sourceUtteranceIds: ["u_1"],
      },
    ]);
    expect(out.commandDebug).toBeUndefined();
  });

  it.each([
    "Should I create a card with exactly this text: AI is risky. It removes agency?",
    "Hmm, should I make a card with this exact text: AI is risky. It removes agency?",
    "Hmm, maybe make a card with this exact text: AI is risky.",
  ])("does not execute an exact-text command framed as a question or hedge: %s", async (userText) => {
    const state = createState();

    const out = await processTurn(state, userText, questionLLM("What would help you decide?"));

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toBeUndefined();
  });

  it.each([
    "Do not create a card with exactly this text: AI is risky. It removes agency.",
    "Don't make a card with this exact text: AI is risky. It removes agency.",
  ])("does not execute a negated multi-segment exact-text command: %s", async (userText) => {
    const state = createState();

    const out = await processTurn(state, userText, questionLLM("What would help you decide?"));

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe("What would help you decide?");
  });

  it("still allows a question mark inside an exact-text payload", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Create a card with exactly this text: Is AI risky? It removes agency.",
      questionLLM("some coach question the command should override"),
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "Is AI risky? It removes agency.",
        sourceUtteranceIds: ["u_1", "u_2"],
      },
    ]);
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it("creates a card from a single-segment exact-text payload that is itself a question", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Create a card with exactly this text: Is AI risky?",
      questionLLM("some coach question the command should override"),
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "Is AI risky?",
        sourceUtteranceIds: ["u_1"],
      },
    ]);
  });

  it("creates a card from same-turn text when the user says make that a card", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Different style of AI use that enables user to be in more control.\n\nmake that a card",
      questionLLM("some coach question the command should override"),
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "Different style of AI use that enables user to be in more control.",
        sourceUtteranceIds: ["u_1"],
      },
    ]);
  });

  it("creates a card from same-turn text when the user says turn it into a card", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Different style of AI use that enables user to be in more control.\n\nturn it into a card",
      questionLLM("some coach question the command should override"),
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "Different style of AI use that enables user to be in more control.",
        sourceUtteranceIds: ["u_1"],
      },
    ]);
  });

  it("does not create a card when the user asks whether something should be a card", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What would make human control worth its own card for you?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human control" },
        },
      ],
    });

    const out = await processTurn(state, "Should this be a card: human control?", llm);

    expect(out.mapCommands).toBeUndefined();
    expect(out.mode).toBe("question");
  });

  it("does not create a card when the user asks can you make this a card", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What words would you want on it?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human control" },
        },
      ],
    });

    const out = await processTurn(state, "Can you make this a card: human control?", llm);

    expect(out.mapCommands).toBeUndefined();
  });

  it("creates a card from the immediately preceding same-turn text when the user says make this a card", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "Different style of AI use that enables user to be in more control.\n\nmake this a card",
      questionLLM("some coach question the command should override"),
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "Different style of AI use that enables user to be in more control.",
        sourceUtteranceIds: ["u_1"],
      },
    ]);
  });

  it("does not create a card from same-turn this when there is no same-turn payload", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "make this a card",
      questionLLM("What exact wording should go on the card?"),
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe("What exact wording should go on the card?");
  });

  describe("card-coverage questions", () => {
    const coverageMap = {
      thoughtUnits: [
        mapUnit("tu_46", "Different style of AI use that enables user to be in more control."),
      ],
      connections: [],
    };
    const STALE_SETTLE =
      "Let's zoom out a little — what's one small piece of this you feel sure about?";
    const STALE_FOCUS_QUESTION =
      "Which focused point for this section feels easiest to name first?";

    it("anchors a coverage question to the card instead of settling", async () => {
      const state = createState();

      const out = await processTurn(
        state,
        "is there any major point in this the current card (#46) doesnt cover? Or at least that I need to think about",
        questionLLM(STALE_FOCUS_QUESTION),
        defaultConfig,
        "chat",
        coverageMap,
      );

      expect(out.mapCommands).toBeUndefined();
      expect(out.validatedMirror).toBeUndefined();
      expect(out.mode).toBe("question");
      expect(out.text).toContain("#46");
      expect(out.text).toMatch(/draft|section|least represented|checking/i);
    });

    it("does not repeat the stale previous focus question", async () => {
      const state = createState();
      // Prior AI turn was the generic focus question.
      await processTurn(state, "make this a card", questionLLM(STALE_FOCUS_QUESTION), defaultConfig, "chat", coverageMap);

      const out = await processTurn(
        state,
        "does #46 cover the main point?",
        questionLLM(STALE_FOCUS_QUESTION),
        defaultConfig,
        "chat",
        coverageMap,
      );

      expect(out.text).not.toBe(STALE_FOCUS_QUESTION);
      expect(out.text).toContain("#46");
    });

    it("keeps a follow-up 'not sure' anchored to the coverage concern", async () => {
      const state = createState();
      await processTurn(
        state,
        "is there any major point in this the current card (#46) doesnt cover? Or at least that I need to think about",
        questionLLM(STALE_FOCUS_QUESTION),
        defaultConfig,
        "chat",
        coverageMap,
      );

      const out = await processTurn(state, "not sure", questionLLM(STALE_SETTLE), defaultConfig, "chat", coverageMap);

      expect(out.mode).toBe("clarify");
      expect(out.mapCommands).toBeUndefined();
      expect(out.validatedMirror).toBeUndefined();
      expect(out.text).not.toBe(STALE_SETTLE);
      expect(out.text).toMatch(/#46|draft|section|sentence|checking|represented/i);
    });

    it("does not treat a plain 'not sure' as coverage when no focus is active", async () => {
      const state = createState();

      const out = await processTurn(state, "not sure", questionLLM(STALE_SETTLE), defaultConfig, "chat", coverageMap);

      // Without an active coverage focus, the coverage path must not fire.
      expect(out.text).not.toMatch(/checking .* against first/i);
    });

    it("clears coverage focus after an early-return direct map command", async () => {
      const state = createState();
      await processTurn(
        state,
        "does #46 cover the main point?",
        questionLLM(STALE_FOCUS_QUESTION),
        defaultConfig,
        "chat",
        coverageMap,
      );

      const commandOut = await processTurn(
        state,
        "Create a card with exactly this text: AI is risky. It removes agency.",
        questionLLM("some coach question the command should override"),
        defaultConfig,
        "chat",
        coverageMap,
      );
      expect(commandOut.mapCommands).toEqual([
        {
          kind: "create_card",
          text: "AI is risky. It removes agency.",
          sourceUtteranceIds: ["u_2", "u_3"],
        },
      ]);

      const out = await processTurn(state, "not sure", questionLLM(STALE_SETTLE), defaultConfig, "chat", coverageMap);

      expect(out.text).not.toMatch(/checking .*#46|#46.*checking|represented by #46/i);
    });

    it("does not classify a priority question as coverage just because it says think about", async () => {
      const state = createState();

      const out = await processTurn(
        state,
        "Should this card be the one I think about next?",
        questionLLM("Which card feels most useful to work on next?"),
        defaultConfig,
        "chat",
        coverageMap,
      );

      expect(out.text).toBe("Which card feels most useful to work on next?");
      expect(out.commandDebug?.some((note) => note.reason === "coverage_intent")).not.toBe(true);
    });
  });

  it("hands control back after a complete card command and stays clean on back-to-back commands", async () => {
    const state = createState();
    const cardLLM = (text: string, uttId: string) => (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "some coach question the command should override",
      mapCommands: [
        {
          kind: "create_card",
          text,
          sourceSpan: { utteranceIds: [uttId], userPhrase: text },
        },
      ],
    });

    const first = await processTurn(
      state,
      "put human control on the map",
      cardLLM("human control", "u_1"),
    );
    expect(first.text).toBe("Done. What would you like to do next?");
    expect(first.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);

    // A second complete command must NOT trip the anti-repeat guard into the
    // mirror-suppressed constant — the hand-back repeats legitimately.
    const second = await processTurn(
      state,
      "put ai suggestion on the map",
      cardLLM("ai suggestion", "u_2"),
    );
    expect(second.text).toBe("Done. What would you like to do next?");
    expect(second.mapCommands).toEqual([
      { kind: "create_card", text: "ai suggestion", sourceUtteranceIds: ["u_2"] },
    ]);
  });

  it("keeps an accepted command and suppresses a same-turn mirror", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0 });
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human control" },
        },
      ],
      candidateUpserts: [
        {
          id: "cand1",
          target: "idea",
          gist: "human control",
          addEvidenceIds: ["u_1"],
        },
      ],
      carryForwardCandidateIds: ["cand1"],
      mirror: {
        claims: [
          {
            id: "c1",
            text: "human control",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              { claimText: "human control", utteranceIds: ["u_1"], userPhrase: "human control" },
            ],
          },
        ],
      },
    });

    const out = await processTurn(state, "put human control on the map", llm, cfg);

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);
    expect(out.validatedMirror).toBeUndefined();
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it("keeps a command turn question after executing an accepted command", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "How should this connect to the rest of the map?",
      mapCommands: [
        {
          kind: "create_card",
          text: "human control",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "human control" },
        },
      ],
    });

    const out = await processTurn(
      state,
      "Make a card for human control. I'm not sure how it connects yet.",
      llm,
    );

    expect(out.mode).toBe("clarify");
    expect(out.text).toBe("How should this connect to the rest of the map?");
    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);
    expect(out.validatedMirror).toBeUndefined();
  });

  it("suppresses a redundant follow-up after a complete accepted command", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_90", "AI suggestion"), mapUnit("tu_86", "human control")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What makes supports human control the right link?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "#90",
          targetText: "#86",
          labelText: "supports human control",
        },
      ],
    });

    const out = await processTurn(
      state,
      "Connect #90 to #86 with the label 'supports human control.' Do not ask a follow-up.",
      llm,
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_90" },
        target: { id: "tu_86" },
        labelText: "supports human control",
        labelSourceUtteranceIds: ["u_1"],
      },
    ]);
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it("pivots away when the user wants to move on from an organized card pair", async () => {
    const state = createState();
    await processTurn(
      state,
      "set up candidates",
      organizeQuestionLLM("Staying with #231 and #235, what relationship do you want there?"),
    );

    const called: { value: boolean } = { value: false };
    const llm = (_ctx: LLMContext): LLMTurn => {
      called.value = true;
      return {
        mode: "question",
        text: "Staying with #231 and #235, which one feels easier?",
        questionIntent: "organize",
        questionStance: "organize",
      };
    };

    const out = await processTurn(
      state,
      "I want to move from #231 and #235 and focus on some part of the draft",
      llm,
    );

    expect(called.value).toBe(false);
    expect(out.text).toBe("What would you like to do next?");
    expect(state.organizeFocus).toBeUndefined();
  });

  it("drops the same organize pair after two declines", async () => {
    const state = createState();
    const llm = organizeQuestionLLM("Staying with #205 and #191, what relationship do you want there?");

    await processTurn(state, "set up", llm);
    expect(state.organizeFocus?.refs).toEqual(["#191", "#205"]);

    const first = await processTurn(state, "not sure", llm);
    expect(first.mode).toBe("clarify");
    expect(state.organizeFocus?.declineCount).toBe(1);

    const second = await processTurn(state, "not sure", llm);
    expect(second.text).toBe("What would you like to do next?");
    expect(state.organizeFocus).toBeUndefined();
  });

  it("still allows organize questions when the user has not disengaged", async () => {
    const state = createState();
    const out = await processTurn(
      state,
      "let's compare those",
      organizeQuestionLLM("How do #205 and #191 relate in your words?"),
    );

    expect(out.text).toBe("How do #205 and #191 relate in your words?");
    expect(state.organizeFocus?.refs).toEqual(["#191", "#205"]);
    expect(state.organizeFocus?.declineCount).toBe(0);
  });

  it("reflects a compact relationship answer for confirmation instead of pivoting to card capture", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_448", "support information"),
        mapUnit("tu_451", "main claim"),
        mapUnit("tu_452", "constraint"),
      ],
      connections: [],
    };

    await processTurn(
      state,
      "let's relate these",
      organizeQuestionLLM("How would you describe the relationship between #448 and #451 in your own words?"),
      defaultConfig,
      "chat",
      map,
    );

    const called = { value: false };
    const out = await processTurn(
      state,
      "support detail",
      () => {
        called.value = true;
        return organizeQuestionLLM("What part of that feels most important to carry forward on the map?")({} as LLMContext);
      },
      defaultConfig,
      "chat",
      map,
    );

    expect(called.value).toBe(false);
    expect(out.text).toBe(
      "It sounds like you want the relationship wording to be 'support detail' between #448 and #451. Is that right?",
    );
    expect(out.mapCommands).toBeUndefined();
    expect(out.commandConfirmation?.kind).toBe("relationship_confirmation");
  });

  it("creates the labeled connection after the user confirms compact relationship wording", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_448", "support information"),
        mapUnit("tu_451", "main claim"),
        mapUnit("tu_452", "constraint"),
      ],
      connections: [],
    };
    await processTurn(
      state,
      "set focus",
      organizeQuestionLLM("How would you describe the relationship between #448 and #451 in your own words?"),
      defaultConfig,
      "chat",
      map,
    );
    await processTurn(state, "support detail", questionLLM("ignored"), defaultConfig, "chat", map);

    const out = await processTurn(state, "yes", questionLLM("ignored"), defaultConfig, "chat", map);

    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "support detail",
        labelSourceUtteranceIds: ["u_2"],
      },
    ]);
    expect(out.text).toBe("Done. What would you like to do next?");
  });

  it("captures a medium-length relational answer under organize focus instead of re-asking", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_86", "monitoring"),
        mapUnit("tu_166", "control"),
        mapUnit("tu_9", "draft"),
      ],
      connections: [],
    };
    state.organizeFocus = { refs: ["#86", "#166"], key: "#86|#166", declineCount: 0 };
    const answer =
      "Control is one part of monitoring, and monitoring is not only seeing the thinking process but also deciding which ideas become part of that process.";

    const called = { value: false };
    const out = await processTurn(
      state,
      answer,
      () => {
        called.value = true;
        return organizeQuestionLLM("How do #86 and #166 relate?")({} as LLMContext);
      },
      defaultConfig,
      "chat",
      map,
    );

    // Early relationship capture returns before the LLM is consulted — proving it
    // routed to confirmation rather than re-asking the relationship question.
    expect(called.value).toBe(false);
    expect(out.commandConfirmation?.kind).toBe("relationship_confirmation");
    expect(state.pendingMapCommand?.kind).toBe("relationship_confirmation");
    expect(
      state.pendingMapCommand?.kind === "relationship_confirmation"
        ? state.pendingMapCommand.labelText
        : "",
    ).toBe(answer);
    expect(out.mapCommands).toBeUndefined();
  });

  it("does not let sparse-map fallback override a compact relationship answer for an active pair", async () => {
    const state = createState();
    const sparseMap = {
      thoughtUnits: [mapUnit("tu_448", "support information"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    state.organizeFocus = { refs: ["#448", "#451"], key: "#448|#451", declineCount: 0 };

    const out = await processTurn(
      state,
      "support detail",
      organizeQuestionLLM("What exact wording do you want to carry forward as the next card?"),
      defaultConfig,
      "chat",
      sparseMap,
    );

    expect(out.text).toBe(
      "It sounds like you want the relationship wording to be 'support detail' between #448 and #451. Is that right?",
    );
    expect(out.text).not.toContain("What exact wording do you want to carry forward as the next card?");
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

    const out = await processTurn(state, "I'd like human control as a card", llm);

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

    const out = await processTurn(state, "I'd like human control as a card", llm);

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

  it("does not execute a create-card command for a vague anaphoric placeholder", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What exact wording should go on that card?",
      mapCommands: [
        {
          kind: "create_card",
          text: "authorial choices idea",
          sourceSpan: { utteranceIds: ["u_1"], userPhrase: "authorial choices idea" },
        },
      ],
    });

    const out = await processTurn(
      state,
      "Actually make the earlier authorial choices idea into one card too, but keep it broad.",
      llm,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug).toEqual([
      {
        reason: "vague_anaphoric_card_text",
        detail: 'Blocked vague anaphoric card text "authorial choices idea".',
      },
    ]);
  });

  it("does not execute structure commands when references cannot resolve", async () => {
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

  it("accepts imperative nesting commands when the parent resolves uniquely", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "nest_card",
          childText: "human control",
          parentText: "authorship",
        },
      ],
    });

    const out = await processTurn(
      state,
      "put human control under authorship",
      llm,
      defaultConfig,
      "chat",
      { thoughtUnits: [mapUnit("parent", "authorship")], connections: [] },
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "nest_card",
        child: { text: "human control", sourceUtteranceIds: ["u_1"] },
        parentId: "parent",
      },
    ]);
  });

  it("collects requested smaller-card wording under the remembered parent", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_577", "Mechanism 1 to prevent authorship: Constrain")],
      connections: [],
    };

    const first = await processTurn(
      state,
      "the 2 smaller card",
      questionLLM("Which exact words should go on the 2 smaller card?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(first.text).toBe("Which exact words should go on the 2 smaller card?");
    expect(state.pendingChildPlacement).toEqual({
      parentId: "tu_577",
      parentText: "Mechanism 1 to prevent authorship: Constrain",
      remaining: 2,
    });

    const called = { value: false };
    const second = await processTurn(
      state,
      "No silent commit-Solve by No-silent-commit and multiple choice confirmation gate",
      () => {
        called.value = true;
        return questionLLM("ignored")({} as LLMContext);
      },
      defaultConfig,
      "chat",
      map,
    );

    expect(called.value).toBe(false);
    expect(second.mapCommands).toEqual([
      {
        kind: "nest_card",
        child: {
          text: "No silent commit-Solve by No-silent-commit and multiple choice confirmation gate",
          sourceUtteranceIds: ["u_2"],
        },
        parentId: "tu_577",
      },
    ]);
    expect(second.text).toBe(
      "What exact words do you want on the other smaller card under Mechanism 1 to prevent authorship: Constrain?",
    );
  });

  it("finishes the pending smaller-card flow after the final child wording", async () => {
    const state = createState();
    state.pendingChildPlacement = {
      parentId: "tu_577",
      parentText: "Mechanism 1 to prevent authorship: Constrain",
      remaining: 1,
    };
    const map = {
      thoughtUnits: [mapUnit("tu_577", "Mechanism 1 to prevent authorship: Constrain")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "No AI words-AI is only allowed to use grammatical function words",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "nest_card",
        child: {
          text: "No AI words-AI is only allowed to use grammatical function words",
          sourceUtteranceIds: ["u_1"],
        },
        parentId: "tu_577",
      },
    ]);
    expect(out.text).toBe("Done. What would you like to do next?");
    expect(state.pendingChildPlacement).toBeUndefined();
  });

  it("does not nest a question asked while a child placement is pending", async () => {
    const state = createState();
    state.pendingChildPlacement = {
      parentId: "tu_577",
      parentText: "Mechanism 1 to prevent authorship: Constrain",
      remaining: 2,
    };
    const map = {
      thoughtUnits: [mapUnit("tu_577", "Mechanism 1 to prevent authorship: Constrain")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "Can you give me an example?",
      questionLLM("Here's one shape it could take — what would you write?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(state.pendingChildPlacement).toEqual({
      parentId: "tu_577",
      parentText: "Mechanism 1 to prevent authorship: Constrain",
      remaining: 2,
    });
  });

  it("does not execute nesting commands when the parent reference is ambiguous", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Which authorship card should it go under?",
      mapCommands: [
        {
          kind: "nest_card",
          childText: "human control",
          parentText: "authorship",
        },
      ],
    });

    const out = await processTurn(
      state,
      "put human control under authorship",
      llm,
      defaultConfig,
      "chat",
      {
        thoughtUnits: [mapUnit("parent1", "authorship"), mapUnit("parent2", "authorship")],
        connections: [],
      },
    );

    expect(out.mapCommands).toBeUndefined();
  });

  it("holds an unlabeled imperative connection command until the user supplies a label", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
      connections: [],
    };
    const firstLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should the label be?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "human control",
          targetText: "authorship",
        },
      ],
    });

    const first = await processTurn(
      state,
      "connect human control to authorship",
      firstLLM,
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    expect(first.mapCommands).toBeUndefined();
    expect(first.text).toBe('What should the label be between "human control" and "authorship"?');

    let called = false;
    const secondLLM = (_ctx: LLMContext): LLMTurn => {
      called = true;
      return { mode: "question", text: "should not be called" };
    };
    const second = await processTurn(
      state,
      "supports human control",
      secondLLM,
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    expect(called).toBe(false);
    expect(second.validatedMirror).toBeUndefined();
    expect(second.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "source" },
        target: { id: "target" },
        labelText: "supports human control",
        labelSourceUtteranceIds: ["u_2"],
      },
    ]);
  });

  it.each(["no label", "skip label", "skip", "none", "leave it unlabeled"])(
    "creates an unlabeled connection when the user declines the label with %s",
    async (declineText) => {
      const state = createState();
      const map = {
        thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
        connections: [],
      };
      const firstLLM = (_ctx: LLMContext): LLMTurn => ({
        mode: "question",
        text: "What should the label be?",
        mapCommands: [{ kind: "connect_cards", sourceText: "human control", targetText: "authorship" }],
      });

      const first = await processTurn(
        state,
        "connect human control to authorship",
        firstLLM,
        defaultConfig,
        "chat",
        map,
        { requireConnectionLabel: true },
      );
      expect(first.mapCommands).toBeUndefined();
      expect(first.commandConfirmation?.kind).toBe("connection_label");

      let called = false;
      const secondLLM = (_ctx: LLMContext): LLMTurn => {
        called = true;
        return { mode: "question", text: "should not be called" };
      };
      const second = await processTurn(
        state,
        declineText,
        secondLLM,
        defaultConfig,
        "chat",
        map,
        { requireConnectionLabel: true },
      );

      expect(called).toBe(false);
      expect(second.mapCommands).toEqual([
        { kind: "connect_cards", source: { id: "source" }, target: { id: "target" } },
      ]);
      expect(second.commandDebug?.[0]?.reason).toBe("connection_label_skipped");
      // The decline itself must not leak into the mirror/bank as content.
      expect(state.bank.get("u_2")?.commandOnly).toBe(true);
    },
  );

  it("treats a multi-word phrase that merely contains a decline word as a real label", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
      connections: [],
    };
    const firstLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should the label be?",
      mapCommands: [{ kind: "connect_cards", sourceText: "human control", targetText: "authorship" }],
    });
    await processTurn(state, "connect human control to authorship", firstLLM, defaultConfig, "chat", map, {
      requireConnectionLabel: true,
    });

    const second = await processTurn(
      state,
      "none of it works without human control",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    expect(second.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "source" },
        target: { id: "target" },
        labelText: "none of it works without human control",
        labelSourceUtteranceIds: ["u_2"],
      },
    ]);
  });

  it("accepts imperative unlabeled connection commands directly when label mode is off", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "human control",
          targetText: "authorship",
        },
      ],
    });

    const out = await processTurn(
      state,
      "connect human control to authorship",
      llm,
      defaultConfig,
      "chat",
      {
        thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
        connections: [],
      },
      { requireConnectionLabel: false },
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "source" },
        target: { id: "target" },
        labelText: undefined,
        labelSourceUtteranceIds: undefined,
      },
    ]);
  });

  it("resolves #ref endpoints to existing cards even when the label trips the declarative detector", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "#59",
          targetText: "#44",
          labelText: "supports human control",
        },
      ],
    });

    const out = await processTurn(
      state,
      'Connect #59 to #44 with the label "supports human control"',
      llm,
      defaultConfig,
      "chat",
      {
        thoughtUnits: [
          mapUnit("tu_59", "mind maps let the user hold multiple possible relationships"),
          mapUnit("tu_44", "human control"),
        ],
        connections: [],
      },
    );

    // The endpoints must resolve to the existing cards by their #refs; the
    // label word "supports" must NOT cause a declarative/tentative block.
    expect(out.mapCommands?.[0]).toMatchObject({
      kind: "connect_cards",
      source: { id: "tu_59" },
      target: { id: "tu_44" },
    });
  });

  it("extracts a quoted natural-form label even when the command omits labelText", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Done.",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "#59",
          targetText: "#44",
        },
      ],
    });

    const out = await processTurn(
      state,
      "Connect #59 to #44 with the label \u201csupports human control.\u201d",
      llm,
      defaultConfig,
      "chat",
      {
        thoughtUnits: [
          mapUnit("tu_59", "mind maps let the user hold multiple possible relationships"),
          mapUnit("tu_44", "human control"),
        ],
        connections: [],
      },
      { requireConnectionLabel: true },
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_59" },
        target: { id: "tu_44" },
        labelText: "supports human control",
        labelSourceUtteranceIds: ["u_1"],
      },
    ]);
  });

  it("keeps command-only connection wording out of continuation mirror context", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_109", "AI suggestion"),
        mapUnit("tu_111", "human control"),
      ],
      connections: [],
    };
    const firstLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Done.",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "#109",
          targetText: "#111",
          labelText: "supports human control",
        },
      ],
      candidateUpserts: [
        {
          id: "cmd_idea",
          target: "idea",
          gist: 'Connect #109 to #111 with the label "supports human control."',
          addEvidenceIds: ["u_1"],
        },
      ],
    });

    const first = await processTurn(
      state,
      'Connect #109 to #111 with the label "supports human control."',
      firstLLM,
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    expect(first.mapCommands?.[0]).toMatchObject({
      kind: "connect_cards",
      source: { id: "tu_109" },
      target: { id: "tu_111" },
      labelText: "supports human control",
    });
    expect(state.bank.getAll()).toEqual([
      expect.objectContaining({
        id: "u_1",
        text: 'Connect #109 to #111 with the label "supports human control."',
        commandOnly: true,
      }),
    ]);
    expect(state.candidates.get("cmd_idea")).toBeUndefined();

    let sawCommandInBank = false;
    const secondLLM = (ctx: LLMContext): LLMTurn => {
      sawCommandInBank = ctx.bank.some((utterance) =>
        utterance.text.includes('Connect #109 to #111 with the label "supports human control."'),
      );
      return sawCommandInBank
        ? groundedMirrorLLM(
            'Connect #109 to #111 with the label "supports human control."',
            "u_1",
          )(ctx)
        : { mode: "question", text: "What does that connection change?" };
    };

    const second = await processTurn(
      state,
      "",
      secondLLM,
      defaultConfig,
      "chat",
      map,
      { ingestUser: false, continuationFocus: ["supports human control"] },
    );

    expect(sawCommandInBank).toBe(false);
    expect(second.mode).toBe("question");
    expect(second.validatedMirror).toBeUndefined();
    expect(second.text).toBe("What does that connection change?");
  });

  it("keeps an imperative connection command when an emitted label is ungrounded", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "human control",
          targetText: "authorship",
          labelText: "preserves",
        },
      ],
    });

    const out = await processTurn(
      state,
      "connect human control to authorship",
      llm,
      defaultConfig,
      "chat",
      {
        thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
        connections: [],
      },
      { requireConnectionLabel: false },
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "source" },
        target: { id: "target" },
        labelText: undefined,
        labelSourceUtteranceIds: undefined,
      },
    ]);
  });

  it("does not execute declarative relationship statements as connection commands", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "How do those relate in your words?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "human control",
          targetText: "authorship",
        },
      ],
    });

    const out = await processTurn(
      state,
      "human control supports authorship",
      llm,
      defaultConfig,
      "chat",
      {
        thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
        connections: [],
      },
    );

    expect(out.mapCommands).toBeUndefined();
  });

  it("asks for confirmation instead of creating a duplicate when a connection endpoint is a unique near match", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "control",
          targetText: "authorship",
        },
      ],
    });

    const out = await processTurn(
      state,
      "connect control to authorship",
      llm,
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain('"control" -> "human control"');
    expect(out.commandDebug?.some((note) => note.reason === "near_match_pending")).toBe(true);
  });

  it("executes a pending near-match command after the user confirms it", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("source", "human control"), mapUnit("target", "authorship")],
      connections: [],
    };
    const firstLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "control",
          targetText: "authorship",
        },
      ],
    });

    await processTurn(state, "connect control to authorship", firstLLM, defaultConfig, "chat", map);

    let called = false;
    const secondLLM = (_ctx: LLMContext): LLMTurn => {
      called = true;
      return { mode: "question", text: "should not be called" };
    };
    const out = await processTurn(state, "yes", secondLLM, defaultConfig, "chat", map);

    expect(called).toBe(false);
    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "source" },
        target: { id: "target" },
      },
    ]);
    expect(out.commandDebug).toEqual([
      {
        reason: "near_match_confirmed",
        detail: 'near_match_pending: "control" -> "human control" for connection',
      },
    ]);
  });

  it("rejects a connect_cards command that names an already-nested card", async () => {
    const state = createState();
    const nestedChild: ThoughtUnit = {
      id: "tu_12",
      text: "artifact ownership",
      role: "content",
      parentId: "tu_10",
      source: { utteranceIds: ["u_tu_12"], createdBy: "user" },
      roleHistory: [{ role: "content", changedBy: "user", at: 1 }],
    };
    const map = {
      thoughtUnits: [mapUnit("tu_10", "authorial ownership"), nestedChild, mapUnit("tu_5", "reader trust")],
      connections: [],
    };
    let called = false;
    const llm = (_ctx: LLMContext): LLMTurn => {
      called = true;
      return {
        mode: "question",
        text: "Done.",
        mapCommands: [{ kind: "connect_cards", sourceText: "#12", targetText: "#5" }],
      };
    };

    const out = await processTurn(state, "connect #12 to #5", llm, defaultConfig, "chat", map);

    expect(called).toBe(true);
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("#12");
    expect(out.text).toContain("nested inside #10");
    expect(out.commandDebug?.some((note) => note.reason === "nested_endpoint_blocked")).toBe(true);
  });

  it("rejects a near-match confirmation that resolves to an already-nested card", async () => {
    const state = createState();
    const nestedSource: ThoughtUnit = {
      id: "source",
      text: "human control",
      role: "content",
      parentId: "target",
      source: { utteranceIds: ["u_source"], createdBy: "user" },
      roleHistory: [{ role: "content", changedBy: "user", at: 1 }],
    };
    const map = {
      thoughtUnits: [nestedSource, mapUnit("target", "authorship")],
      connections: [],
    };
    const firstLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [{ kind: "connect_cards", sourceText: "control", targetText: "authorship" }],
    });

    await processTurn(state, "connect control to authorship", firstLLM, defaultConfig, "chat", map);

    let called = false;
    const secondLLM = (_ctx: LLMContext): LLMTurn => {
      called = true;
      return { mode: "question", text: "should not be called" };
    };
    const out = await processTurn(state, "yes", secondLLM, defaultConfig, "chat", map);

    expect(called).toBe(false);
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("nested inside");
    expect(out.commandDebug?.some((note) => note.reason === "nested_endpoint_blocked")).toBe(true);
  });

  it("rejects a pending connection-label completion if an endpoint became nested", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_10", "authorship"),
        nestedMapUnit("tu_12", "human control", "tu_10"),
        mapUnit("tu_5", "reader trust"),
      ],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "connection_label",
      command: {
        kind: "connect_cards",
        source: { id: "tu_12" },
        target: { id: "tu_5" },
      },
      prompt: "What should the label be?",
      debug: "connection_label_pending",
    };

    const out = await processTurn(state, "supports", questionLLM("ignored"), defaultConfig, "chat", map);

    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("#12");
    expect(out.text).toContain("nested inside #10");
    expect(out.commandDebug?.some((note) => note.reason === "nested_endpoint_blocked")).toBe(true);
  });

  it("rejects a pending relationship confirmation if an endpoint became nested", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_10", "authorship"),
        nestedMapUnit("tu_12", "human control", "tu_10"),
        mapUnit("tu_5", "reader trust"),
      ],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "relationship_confirmation",
      command: {
        kind: "connect_cards",
        source: { id: "tu_12" },
        target: { id: "tu_5" },
        labelText: "supports",
      },
      labelText: "supports",
      prompt: "Is that relationship wording right?",
      debug: "relationship_confirmation_pending",
    };

    const out = await processTurn(state, "yes", questionLLM("ignored"), defaultConfig, "chat", map);

    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("nested inside #10");
    expect(out.commandDebug?.some((note) => note.reason === "nested_endpoint_blocked")).toBe(true);
  });

  it("rejects a pending duplicate confirmation if an endpoint became nested", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_10", "authorship"),
        nestedMapUnit("tu_12", "human control", "tu_10"),
        mapUnit("tu_5", "reader trust"),
      ],
      connections: [
        {
          id: "edge_existing",
          sourceId: "tu_10",
          targetId: "tu_5",
          labelUnitId: "tu_label",
          labelText: "supports",
          sourceText: "authorship",
          targetText: "reader trust",
          utteranceIds: [],
        },
      ],
    };
    state.pendingMapCommand = {
      kind: "duplicate_connection_confirmation",
      command: {
        kind: "connect_cards",
        source: { id: "tu_12" },
        target: { id: "tu_5" },
        labelText: "supports",
      },
      prompt: "There is already a connection. Add another?",
      debug: "duplicate_connection_pending",
    };

    const out = await processTurn(state, "yes", questionLLM("ignored"), defaultConfig, "chat", map);

    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("nested inside #10");
    expect(out.commandDebug?.some((note) => note.reason === "nested_endpoint_blocked")).toBe(true);
  });

  it("still connects two ordinary root cards unaffected by the nested-endpoint check", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_10", "authorial ownership"), mapUnit("tu_5", "reader trust")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Done.",
      mapCommands: [{ kind: "connect_cards", sourceText: "#10", targetText: "#5" }],
    });

    const out = await processTurn(state, "connect #10 to #5", llm, defaultConfig, "chat", map);

    expect(out.mapCommands).toEqual([
      { kind: "connect_cards", source: { id: "tu_10" }, target: { id: "tu_5" } },
    ]);
  });

  it("asks which card when a command reference has multiple near matches", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "control",
          targetText: "authorship",
        },
      ],
    });

    const out = await processTurn(
      state,
      "connect control to authorship",
      llm,
      defaultConfig,
      "chat",
      {
        thoughtUnits: [
          mapUnit("source1", "human control"),
          mapUnit("source2", "control of wording"),
          mapUnit("target", "authorship"),
        ],
        connections: [],
      },
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain('more than one card that could match "control"');
    expect(out.commandDebug?.some((note) => note.reason === "ambiguous_reference")).toBe(true);
  });

  it("asks for confirmation before nesting under a unique near-match parent", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("parent", "human authorship")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should we place next?",
      mapCommands: [
        {
          kind: "nest_card",
          childText: "human control",
          parentText: "authorship",
        },
      ],
    });

    const out = await processTurn(
      state,
      "put human control under authorship",
      llm,
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain('existing card called "human authorship"');
    expect(out.commandDebug?.some((note) => note.reason === "near_match_pending")).toBe(true);
  });

  it("treats explicit #ref link phrasing as command intent and does not fall into carry-forward", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What part of that feels most important to carry forward on the map?",
      mapCommands: [
        {
          kind: "connect_cards",
          sourceText: "#448",
          targetText: "#451",
        },
      ],
    });

    const out = await processTurn(
      state,
      "#448 should link to #451",
      llm,
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: false },
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: undefined,
        labelSourceUtteranceIds: undefined,
      },
    ]);
    expect(out.text).toBe("Done. What would you like to do next?");
  });

  it("executes explicit #ref connection commands when the LLM stays in question mode", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_109", "AI suggestion"), mapUnit("tu_111", "human control")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "Connect #109 to #111.",
      questionLLM("some coach question the command should override"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_109" },
        target: { id: "tu_111" },
        labelText: undefined,
        labelSourceUtteranceIds: undefined,
      },
    ]);
    expect(out.suppressionReason).toBe("command_precedence");
  });

  it("holds deterministic #ref connection commands for a label when label mode is on", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_109", "AI suggestion"), mapUnit("tu_111", "human control")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "Connect #109 to #111.",
      questionLLM("some coach question the command should override"),
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandConfirmation).toMatchObject({
      kind: "connection_label",
      command: {
        kind: "connect_cards",
        source: { id: "tu_109" },
        target: { id: "tu_111" },
      },
    });
  });

  it("keeps explicit #ref join phrasing on the command path with connect-vs-nest clarification", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What part of that feels most important to carry forward on the map?",
    });

    const out = await processTurn(
      state,
      "#448 should join #451",
      llm,
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe(
      "I'm not sure what you mean by join here - do you want to connect #448 and #451, or nest one under the other?",
    );
    expect(out.text).not.toContain("carry forward");
  });

  it("keeps explicit #ref combine phrasing on the command path with connect-vs-nest clarification", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What exact wording do you want the map to carry forward from that?",
    });

    const out = await processTurn(
      state,
      "#448 should combine to #451",
      llm,
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe(
      "I'm not sure what you mean by join here - do you want to connect #448 and #451, or nest one under the other?",
    );
    expect(out.text).not.toContain("carry forward");
  });

  it("keeps awkward explicit #ref nest phrasing on the command path with nesting clarification", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What part feels most important to carry forward on the map?",
    });

    const out = await processTurn(
      state,
      "#448 should nest to #451",
      llm,
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe(
      "Do you want to nest one of those cards under the other? If so, which one should go under which: #448 or #451?",
    );
    expect(out.text).not.toContain("carry forward");
  });

  it("executes explicit #ref put-in nesting commands directly", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_635", "child"), mapUnit("tu_649", "parent")],
      connections: [],
    };

    const called = { value: false };
    const out = await processTurn(
      state,
      "put #635 in #649",
      () => {
        called.value = true;
        return organizeQuestionLLM("What words do you want to use for the relationship between #649 and #635?")({} as LLMContext);
      },
      defaultConfig,
      "chat",
      map,
    );

    expect(called.value).toBe(false);
    expect(out.mapCommands).toEqual([
      {
        kind: "nest_card",
        child: { id: "tu_635" },
        parentId: "tu_649",
      },
    ]);
    expect(out.text).toBe("Done. What would you like to do next?");
  });

  it("does not nest when the user negates an explicit #ref placement command", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_635", "child"), mapUnit("tu_649", "parent")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "Do not put #635 in #649.",
      questionLLM("What relationship, if any, do you want between them?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
  });

  it("does not connect when the user negates an explicit #ref connect command", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "Don't connect #448 to #451.",
      questionLLM("How would you describe the relationship between them?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
  });

  it("does not execute question-shaped explicit placement as a command", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_635", "child"), mapUnit("tu_649", "parent")],
      connections: [],
    };
    const called = { value: false };

    const out = await processTurn(
      state,
      "should I put #635 in #649?",
      () => {
        called.value = true;
        return questionLLM("Do you want that placement?")({} as LLMContext);
      },
      defaultConfig,
      "chat",
      map,
    );

    expect(called.value).toBe(true);
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe("Do you want that placement?");
  });

  it("drops an LLM edit_card emitted off a question-shaped turn without a question mark", async () => {
    const state = createState();
    const map = { thoughtUnits: [mapUnit("tu_10", "authorial ownership")], connections: [] };
    // Voice input often drops the "?" — a leading modal alone must still read as
    // asking WHETHER to act, never execute the model's edit.
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Do you want #10 to say that?",
      mapCommands: [
        {
          kind: "edit_card",
          cardText: "#10",
          newText: "human oversight",
          sourceSpan: { userPhrase: "human oversight", utteranceIds: [] },
        },
      ],
    });

    const out = await processTurn(state, "Could #10 say human oversight", llm, defaultConfig, "chat", map);

    expect(out.mapCommands ?? []).toHaveLength(0);
  });

  it("does not execute uncertain explicit placement when uncertainty appears before the command", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_635", "child"), mapUnit("tu_649", "parent")],
      connections: [],
    };
    const called = { value: false };

    const out = await processTurn(
      state,
      "I'm not sure, put #635 in #649",
      () => {
        called.value = true;
        return questionLLM("Do you want that placement?")({} as LLMContext);
      },
      defaultConfig,
      "chat",
      map,
    );

    expect(called.value).toBe(true);
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe("Do you want that placement?");
  });

  it("does not execute uncertain explicit placement when uncertainty trails the command", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_635", "child"), mapUnit("tu_649", "parent")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "put #635 in #649 maybe",
      questionLLM("Do you want that placement?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe("Do you want that placement?");
  });

  it("executes explicit #ref into nesting commands directly", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_635", "child"), mapUnit("tu_649", "parent")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "put #649 into #635",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "nest_card",
        child: { id: "tu_649" },
        parentId: "tu_635",
      },
    ]);
    expect(out.text).toBe("Done. What would you like to do next?");
  });

  it("executes subject-first #ref nest-to commands directly", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_35", "child"), mapUnit("tu_33", "parent")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "#35 nest to #33",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "nest_card",
        child: { id: "tu_35" },
        parentId: "tu_33",
      },
    ]);
    expect(out.text).toBe("Done. What would you like to do next?");
  });

  it("does not fall into carry-forward when a #ref relationship phrase uses authored wording", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What relationship, if any, do you want between #451 and #448 in your own words?",
    });

    const out = await processTurn(
      state,
      "#448 is a support information of #451",
      llm,
      defaultConfig,
      "chat",
      map,
    );

    expect(out.text).not.toContain("carry forward");
    expect(out.text).not.toContain("What exact wording do you want the map to carry forward");
  });

  it("asks before adding another connection between the same unordered pair", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [
        {
          id: "edge_1",
          sourceId: "tu_451",
          targetId: "tu_448",
          labelUnitId: "tu_label",
          labelText: "supports",
          sourceText: "main claim",
          targetText: "support detail",
          utteranceIds: [],
        },
      ],
    };

    const out = await processTurn(
      state,
      'Connect #448 to #451 with the label "link".',
      () => ({
        mode: "question",
        text: "ignored",
        mapCommands: [
          {
            kind: "connect_cards",
            sourceText: "#448",
            targetText: "#451",
            labelText: "link",
          },
        ],
      }),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandConfirmation?.kind).toBe("duplicate_connection_confirmation");
    expect(out.text).toContain("There is already a connection");

    const confirmed = await processTurn(
      state,
      "yes",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(confirmed.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "link",
        labelSourceUtteranceIds: [state.bank.getAll()[0].id],
      },
    ]);
  });

  it("lets a fresh subject-first nest command preempt a pending duplicate connection confirmation", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_27", "every action of AI need confirmation from user"),
        mapUnit("tu_28", "Mechanism 1 - Constraint"),
        mapUnit("tu_33", "No AI words"),
        mapUnit("tu_35", "AI can only use writer's own word"),
      ],
      connections: [
        {
          id: "edge_existing",
          sourceId: "tu_27",
          targetId: "tu_28",
          labelUnitId: "tu_label",
          labelText: "supports",
          sourceText: "every action of AI need confirmation from user",
          targetText: "Mechanism 1 - Constraint",
          utteranceIds: [],
        },
      ],
    };
    state.pendingMapCommand = {
      kind: "duplicate_connection_confirmation",
      command: {
        kind: "connect_cards",
        source: { id: "tu_27" },
        target: { id: "tu_28" },
      },
      prompt: "There is already a connection between those cards. Do you want to add another relationship?",
      debug: "duplicate_connection_pending",
    };

    const out = await processTurn(
      state,
      "#35 nest into #33",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.commandConfirmation).toBeUndefined();
    expect(out.text).toBe("Done. What would you like to do next?");
    expect(out.text).not.toContain("duplicate connection pending");
    expect(out.mapCommands).toEqual([
      {
        kind: "nest_card",
        child: { id: "tu_35" },
        parentId: "tu_33",
      },
    ]);
  });

  it("requires a label after confirming a near-match connection when label mode is on", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "human control"), mapUnit("tu_451", "authorship")],
      connections: [],
    };

    const pending = await processTurn(
      state,
      "connect control to #451",
      () => ({
        mode: "question",
        text: "ignored",
        mapCommands: [
          {
            kind: "connect_cards",
            sourceText: "control",
            targetText: "#451",
          },
        ],
      }),
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    expect(pending.commandConfirmation?.kind).toBe("reference_confirmation");

    const confirmed = await processTurn(
      state,
      "yes",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    expect(confirmed.mapCommands).toBeUndefined();
    expect(confirmed.commandConfirmation?.kind).toBe("connection_label");
    expect(confirmed.text).toContain("What should the label be");

    const labeled = await processTurn(
      state,
      "supports authorship",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
      { requireConnectionLabel: true },
    );

    const bankAfterLabel = state.bank.getAll();
    const labelSourceId = bankAfterLabel[bankAfterLabel.length - 1]?.id;
    expect(labeled.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "supports authorship",
        labelSourceUtteranceIds: [labelSourceId],
      },
    ]);
    expect(labeled.commandDebug?.[0]?.reason).toBe("connection_label_completed");
  });

  it("updates a near-match pending command when the user names a corrected card", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_448", "human control"),
        mapUnit("tu_451", "authorship"),
        mapUnit("tu_452", "agency"),
      ],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "reference_confirmation",
      command: {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "supports",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "I found an existing card called \"human control\" for \"control\". Did you mean that one?",
      debug: "near_match_pending",
      correctionSlots: ["source"],
    };

    const corrected = await processTurn(
      state,
      "agency",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(corrected.commandConfirmation?.kind).toBe("reference_confirmation");
    expect(corrected.text).toContain("agency");

    const confirmed = await processTurn(
      state,
      "yes",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(confirmed.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_452" },
        target: { id: "tu_451" },
        labelText: "supports",
        labelSourceUtteranceIds: ["u_label"],
      },
    ]);
  });

  it("keeps a near-match pending command after rejection so the user can name the corrected card", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_448", "human control"),
        mapUnit("tu_451", "authorship"),
        mapUnit("tu_452", "agency"),
      ],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "reference_confirmation",
      command: {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "supports",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: 'I found an existing card called "human control" for "control". Did you mean that one?',
      debug: "near_match_pending",
      correctionSlots: ["source"],
    };

    // Turn 1: reject the suggested near-match — the command must stay pending.
    const rejected = await processTurn(state, "no", questionLLM("ignored"), defaultConfig, "chat", map);
    expect(rejected.mapCommands).toBeUndefined();
    expect(state.pendingMapCommand?.kind).toBe("reference_confirmation");
    expect(rejected.text).toContain("which exact card");

    // Turn 2: name the corrected card — updates the correction slot.
    const corrected = await processTurn(state, "agency", questionLLM("ignored"), defaultConfig, "chat", map);
    expect(corrected.commandConfirmation?.kind).toBe("reference_confirmation");
    expect(corrected.text).toContain("agency");

    // Turn 3: confirm — executes the corrected command, no stale ref.
    const confirmed = await processTurn(state, "yes", questionLLM("ignored"), defaultConfig, "chat", map);
    expect(confirmed.mapCommands).toEqual([
      {
        kind: "connect_cards",
        source: { id: "tu_452" },
        target: { id: "tu_451" },
        labelText: "supports",
        labelSourceUtteranceIds: ["u_label"],
      },
    ]);
  });

  it("does not re-accept a rejected near-match if the user then says yes", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "human control"), mapUnit("tu_451", "authorship")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "reference_confirmation",
      command: { kind: "connect_cards", source: { id: "tu_448" }, target: { id: "tu_451" } },
      prompt: 'I found an existing card called "human control" for "control". Did you mean that one?',
      debug: "near_match_pending",
      correctionSlots: ["source"],
    };

    await processTurn(state, "no", questionLLM("ignored"), defaultConfig, "chat", map);
    const out = await processTurn(state, "yes", questionLLM("ignored"), defaultConfig, "chat", map);

    expect(out.mapCommands).toBeUndefined();
    expect(state.pendingMapCommand?.kind).toBe("reference_confirmation");
  });

  it("cancels a near-match pending command on 'never mind' instead of asking for a correction", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "human control"), mapUnit("tu_451", "authorship")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "reference_confirmation",
      command: { kind: "connect_cards", source: { id: "tu_448" }, target: { id: "tu_451" } },
      prompt: 'I found an existing card called "human control" for "control". Did you mean that one?',
      debug: "near_match_pending",
      correctionSlots: ["source"],
    };

    const out = await processTurn(state, "never mind", questionLLM("ignored"), defaultConfig, "chat", map);

    expect(out.mapCommands).toBeUndefined();
    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.commandDebug?.[0]?.reason).toBe("near_match_cancelled");
  });

  it("does not ask for a correction it cannot apply when a multi-slot near-match is rejected", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "human control"), mapUnit("tu_451", "authorship")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "reference_confirmation",
      command: { kind: "connect_cards", source: { id: "tu_448" }, target: { id: "tu_451" } },
      prompt: 'I found existing card matches for this connection. Did you mean those?',
      debug: "near_match_pending",
      correctionSlots: ["source", "target"],
    };

    const out = await processTurn(state, "no", questionLLM("ignored"), defaultConfig, "chat", map);

    // Both endpoints were ambiguous, so there is no single slot to correct: drop
    // the command and ask the user to restate — never "which exact card?" with
    // the state already gone.
    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.text).not.toContain("which exact card");
    expect(out.commandDebug?.[0]?.reason).toBe("near_match_rejected");
  });

  it("blocks existing-card connections when the model uses endpoints the user did not name", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_448", "support detail"),
        mapUnit("tu_451", "main claim"),
        mapUnit("tu_452", "unmentioned"),
      ],
      connections: [],
    };

    const out = await processTurn(
      state,
      "Connect something to #448.",
      () => ({
        mode: "question",
        text: "Done.",
        mapCommands: [
          {
            kind: "connect_cards",
            sourceText: "#448",
            targetText: "#452",
            labelText: "link",
          },
        ],
      }),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "ungrounded_existing_endpoint")).toBe(true);
  });

  it("blocks model-emitted structural commands when the user's #ref placement is uncertain", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_635", "No AI words"), mapUnit("tu_649", "Mechanism")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "should I put #635 in #649?",
      () => ({
        mode: "question",
        text: "Done.",
        mapCommands: [
          {
            kind: "nest_card",
            childText: "#635",
            parentText: "#649",
          },
        ],
      }),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug).toEqual([
      {
        reason: "command_uncertainty",
        detail: "Blocked map command because the user phrased the structural action as uncertain/question-shaped.",
      },
    ]);
  });

  it("treats No-prefixed relationship correction as wording, not rejection", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "relationship_confirmation",
      labelText: "support detail",
      command: {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "support detail",
        labelSourceUtteranceIds: [],
      },
      prompt: "It sounds like you want support detail. Is that right?",
      debug: "relationship_confirmation_pending",
    };

    const out = await processTurn(
      state,
      "No AI words",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandConfirmation?.kind).toBe("relationship_confirmation");
    expect(out.text).toContain("'No AI words'");
    expect(state.pendingMapCommand?.kind).toBe("relationship_confirmation");
    expect(state.pendingMapCommand?.kind === "relationship_confirmation" ? state.pendingMapCommand.labelText : "").toBe("No AI words");
    expect(state.pendingMapCommand?.kind === "relationship_confirmation" ? state.pendingMapCommand.command.labelText : "").toBe("No AI words");
    expect(state.pendingMapCommand?.kind === "relationship_confirmation" ? state.pendingMapCommand.command.labelSourceUtteranceIds : []).toEqual(
      state.bank.getAll().map((unit) => unit.id),
    );
  });

  it("clears a pending relationship confirmation on cancel without awaiting correction", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "relationship_confirmation",
      labelText: "support detail",
      command: {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "support detail",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "It sounds like you want support detail. Is that right?",
      debug: "relationship_confirmation_pending",
    };

    const out = await processTurn(
      state,
      "cancel",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "relationship_cancelled")).toBe(true);
  });

  it("cancels a pending relationship confirmation on bare no", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "relationship_confirmation",
      labelText: "support detail",
      command: {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "support detail",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "It sounds like you want support detail. Is that right?",
      debug: "relationship_confirmation_pending",
    };

    const rejected = await processTurn(
      state,
      "no",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(rejected.mapCommands).toBeUndefined();
    expect(rejected.commandConfirmation).toBeUndefined();
    expect(state.pendingMapCommand).toBeUndefined();
    expect(rejected.text).toContain("won't create that connection");
    expect(rejected.commandDebug).toEqual([
      {
        reason: "relationship_cancelled",
        detail: "relationship_confirmation_pending",
      },
    ]);

    const yes = await processTurn(
      state,
      "yes",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(yes.mapCommands).toBeUndefined();
    expect(yes.commandConfirmation).toBeUndefined();
  });

  it("routes chat-only reflection correction out of pending relationship confirmation", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [
        mapUnit("tu_86", "Could talk about monitoring?"),
        mapUnit("tu_166", "control means the writer decides"),
        mapUnit("tu_183", "Monitoring becomes active control"),
      ],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "relationship_confirmation",
      labelText: "mirror",
      command: {
        kind: "connect_cards",
        source: { id: "tu_86" },
        target: { id: "tu_166" },
        labelText: "mirror",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "It sounds like you want the relationship wording to be 'mirror' between #86 and #166. Is that right?",
      debug: "relationship_confirmation_pending",
    };
    let capturedCtx: LLMContext | undefined;

    const out = await processTurn(
      state,
      "No - I meant mirror the idea back to me, not use mirror as a relationship label. Please reflect this in chat only.",
      (ctx) => {
        capturedCtx = ctx;
        return { mode: "question", text: "What structure should I try to reflect first?", questionStance: "organize" };
      },
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandConfirmation).toBeUndefined();
    expect(state.pendingMapCommand).toBeUndefined();
    expect(capturedCtx?.turnText).toContain("chat only");
    expect(capturedCtx?.organizeFocus).toBeUndefined();
    expect(out.text).toBe("What structure should I try to reflect first?");
  });

  it("cancels pending relationship confirmation on explicit stop-connecting language", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_86", "Could talk about monitoring?"), mapUnit("tu_166", "control means the writer decides")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "relationship_confirmation",
      labelText: "mirror",
      command: {
        kind: "connect_cards",
        source: { id: "tu_86" },
        target: { id: "tu_166" },
        labelText: "mirror",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "It sounds like you want the relationship wording to be 'mirror' between #86 and #166. Is that right?",
      debug: "relationship_confirmation_pending",
    };

    const out = await processTurn(
      state,
      "Cancel the relationship action. Stop trying to connect #86 and #166. I do not want a map change.",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandConfirmation).toBeUndefined();
    expect(state.pendingMapCommand).toBeUndefined();
    expect(out.text).toContain("won't create that connection");
    expect(out.commandDebug).toEqual([
      {
        reason: "relationship_cancelled",
        detail: "relationship_confirmation_pending",
      },
    ]);
  });

  it("does not treat mirror as relationship label while an organize pair is focused", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_86", "Could talk about monitoring?"), mapUnit("tu_166", "control means the writer decides")],
      connections: [],
    };
    state.organizeFocus = {
      refs: ["#86", "#166"],
      key: "#86|#166",
      declineCount: 0,
    };
    let capturedCtx: LLMContext | undefined;
    const out = await processTurn(
      state,
      "mirror",
      (ctx) => {
        capturedCtx = ctx;
        return { mode: "question", text: "What part should I reflect first?", questionStance: "organize" };
      },
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandConfirmation).toBeUndefined();
    expect(state.pendingMapCommand).toBeUndefined();
    expect(capturedCtx?.organizeFocus).toBeUndefined();
    expect(out.text).not.toContain("relationship wording to be 'mirror'");
  });

  it("clears organize focus when a duplicate connection is rejected", async () => {
    const state = createState();
    state.organizeFocus = {
      refs: ["#448", "#451"],
      key: "#448|#451",
      declineCount: 0,
    };
    state.pendingMapCommand = {
      kind: "duplicate_connection_confirmation",
      command: {
        kind: "connect_cards",
        source: { id: "tu_448" },
        target: { id: "tu_451" },
        labelText: "supports",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "There is already a connection. Do you want to add another?",
      debug: "duplicate_connection_pending",
    };

    await processTurn(
      state,
      "no",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      {
        thoughtUnits: [mapUnit("tu_448", "support detail"), mapUnit("tu_451", "main claim")],
        connections: [],
      },
    );

    expect(state.organizeFocus).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Focus-help intent (grounded options instead of stale settle wording)
// ---------------------------------------------------------------------------

describe("focus-help intent", () => {
  const focusMap = {
    thoughtUnits: [
      mapUnit("tu_1", "monitoring the AI"),
      mapUnit("tu_2", "user control over wording"),
      mapUnit("tu_3", "authorship boundary"),
    ],
    connections: [],
  };

  it("replaces a stale focus question with grounded options for 'where could we go from here?'", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "where could we go from here?",
      questionLLM("Which focused point for this section feels easiest to name first?"),
      defaultConfig,
      "chat",
      focusMap,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).not.toMatch(/feels? easiest|feel sure|one small piece|focused point/i);
    expect(out.text).toMatch(/#1|#2|#3/);
    expect(out.text).toMatch(/which one|start with|pursue|build on/i);
  });

  it("does not settle for 'not sure help me think through'", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "not sure help me think through",
      questionLLM("Let's zoom out a little — what's one small piece of this you feel sure about?"),
      defaultConfig,
      "chat",
      focusMap,
    );

    expect(out.text).not.toMatch(/zoom out|one small piece|feel sure/i);
    expect(out.mapCommands).toBeUndefined();
  });

  it("offers a grounded direction for 'any recommendation?'", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "any recommendation?",
      questionLLM("Which part feels easiest to point at right now?"),
      defaultConfig,
      "chat",
      focusMap,
    );

    expect(out.text).toMatch(/#1|#2|#3/);
    expect(out.text).not.toMatch(/feels? easiest|feel sure/i);
    expect(out.mapCommands).toBeUndefined();
  });

  it("does not ask which card feels unfinished for 'what is interesting that I could talk about'", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "what is interesting that I could talk about",
      questionLLM("Which existing card feels most unfinished right now?"),
      defaultConfig,
      "chat",
      focusMap,
    );

    expect(out.text).not.toMatch(/feels? most unfinished/i);
    expect(out.mapCommands).toBeUndefined();
  });

  it("passes a grounded options reply through untouched", async () => {
    const state = createState();
    const grounded =
      "We could look at #1, #2, or #3. Which one do you want to start with?";

    const out = await processTurn(
      state,
      "where should I start?",
      questionLLM(grounded),
      defaultConfig,
      "chat",
      focusMap,
    );

    expect(out.text).toBe(grounded);
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
    expect(out.text).toContain("can't ground the wording cleanly enough yet");
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

  it("uses a relationship-clarity preamble when relational grounding is missing", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "writing supports editing. editing matters.", questionLLM("Q"), cfg);
    const out = await processTurn(state, "sure", (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "Here is what I heard:",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "writing supports editing",
            candidateId: "cand1",
            target: "connection",
            sourceSpans: [
              {
                claimText: "writing supports editing",
                utteranceIds: ["u_2"],
                userPhrase: "supports",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "connection", gist: "writing supports editing", addEvidenceIds: ["u_1", "u_2"] },
      ],
    }), cfg);

    expect(out.mode).toBe("clarify");
    expect(out.text).toContain("I can see the pieces you're naming, but I don't yet have your wording for the relationship itself.");
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

  it("breaks a 2-cycle of alternating carry-forward phrasings with a settle move", async () => {
    const state = createState();
    const map = { thoughtUnits: [], connections: [] };
    const mirrorAttemptLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "here's a structure",
    });

    const first = await processTurn(state, "it depends", mirrorAttemptLLM, defaultConfig, "chat", map);
    const second = await processTurn(state, "it depends", mirrorAttemptLLM, defaultConfig, "chat", map);
    const third = await processTurn(state, "it depends", mirrorAttemptLLM, defaultConfig, "chat", map);

    // Turn 1 suppresses to the carry-forward question; turn 2 rewords it; turn 3
    // would repeat turn 1's phrasing (a 2-cycle a last-turn-only guard misses),
    // so it is forced into a distinct settle move instead.
    expect(first.text).toBe("What part of that feels most important to carry forward on the map?");
    expect(second.text).toBe("What exact wording do you want the map to carry forward from that?");
    expect(third.text).toBe("Let's ease off that one — what's one small part of this you already feel sure about?");
    expect(third.questionStance).toBe("settle");
  });

  it("keeps the two-turn window correct across a command early-return", async () => {
    const state = createState();
    // Two plain question turns establish the window.
    await processTurn(state, "first", questionLLM("Question A"));
    await processTurn(state, "second", questionLLM("Question B"));
    // A command that returns via an early path (not finish()) — with the old
    // finish()-only tracking this left prevAiText pointing at "Question A".
    const cmd = await processTurn(
      state,
      "Create a card with exactly this text: alpha idea. beta idea.",
      questionLLM("ignored"),
    );
    expect(cmd.mapCommands).toBeDefined();
    // "Question A" is now three turns back, not two, so it must NOT be treated
    // as a 2-cycle and de-escalated.
    const out = await processTurn(state, "third", questionLLM("Question A"));
    expect(out.text).toBe("Question A");
  });

  it("uses a next-card carry-forward question instead of organize when the map is sparse", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    const sparseMap = { thoughtUnits: [mapUnit("n_1", "Constraint")], connections: [] };

    const out = await processTurn(
      state,
      "No silent commit matters here",
      organizeQuestionLLM("Between #1 and #2, what relationship do you want to state?"),
      cfg,
      "chat",
      sparseMap,
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe(
      "I'm holding off on organizing this yet because the map is still too sparse. What exact wording do you want to carry forward as the next card?",
    );
    expect(state.activeElicitation).toEqual({ kind: "sparse_map_next_card", targetPhrase: undefined });
  });

  it("counts visible cards, not connection-label units, when deciding whether the map is sparse", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    const sparseMapWithOrphanLabels = {
      thoughtUnits: [
        mapUnit("n_1", "Constraint"),
        { ...mapUnit("label_1", "supports"), role: "connection_label" as const },
        { ...mapUnit("label_2", "qualifies"), role: "connection_label" as const },
      ],
      connections: [],
    };
    let captured: LLMContext | undefined;

    const out = await processTurn(
      state,
      "No silent commit matters here",
      (ctx): LLMTurn => {
        captured = ctx;
        return {
          mode: "question",
          text: "Between #1 and #2, what relationship do you want to state?",
          questionIntent: "organize",
          questionStance: "organize",
        };
      },
      cfg,
      "chat",
      sparseMapWithOrphanLabels,
    );

    expect(captured?.sparseMapBlocksOrganize).toBe(true);
    expect(out.text).toBe(
      "I'm holding off on organizing this yet because the map is still too sparse. What exact wording do you want to carry forward as the next card?",
    );
  });

  it("still allows organize questions once the map has enough visible structure", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    const structuredMap = {
      thoughtUnits: [
        mapUnit("n_1", "Constraint"),
        mapUnit("n_2", "No silent commit"),
        mapUnit("n_3", "No AI words"),
      ],
      connections: [],
    };

    const out = await processTurn(
      state,
      "Thinking about the relationship now",
      organizeQuestionLLM("Between #2 and #3, what relationship do you want to state?"),
      cfg,
      "chat",
      structuredMap,
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe("Between #2 and #3, what relationship do you want to state?");
  });

  it("passes selected-strand context into the next LLM call after a large exploratory selection", async () => {
    const state = createState();
    const bigTurn =
      "Mechanism 1 matters. No silent commit stops authorship loss. No AI words keeps the language user-authored. Multiple choice removes the default path.";
    await processTurn(state, bigTurn, questionLLM("Which exact piece do you want to carry forward first?"));

    let capturedCtx: LLMContext | undefined;
    const capturingLLM = (ctx: LLMContext): LLMTurn => {
      capturedCtx = ctx;
      return { mode: "question", text: "What exact wording do you want the map to carry forward from that?" };
    };

    await processTurn(state, "No AI words", capturingLLM);

    expect(capturedCtx?.activeSelectionContext?.selectedText).toBe("No AI words");
    expect(capturedCtx?.activeSelectionContext?.sourceUtteranceIds.length).toBeGreaterThan(0);
  });

  it("uses active elicitation to mirror a substantive answer without explicit carry-forward wording", async () => {
    const state = createState();
    const cfg: MindmapConfig = {
      ...defaultConfig,
      pacing: {
        ...defaultConfig.pacing,
        minQuestionTurnsBetweenMirrors: 0,
        minReadyCandidatesToBatch: 1,
      },
    };
    const sparseMap = { thoughtUnits: [mapUnit("n_1", "Constraint")], connections: [] };
    state.activeElicitation = { kind: "sparse_map_next_card" };

    const second = await processTurn(
      state,
      "every AI edit needs human confirmation",
      groundedMirrorLLM("every AI edit needs human confirmation", "u_1"),
      cfg,
      "chat",
      sparseMap,
    );

    expect(second.mode).toBe("mirror");
    expect(second.validatedMirror?.reflection.claims[0].text).toBe("every AI edit needs human confirmation");
  });

  it("does not repeat sparse-map exact-wording after the user gives stable card wording", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    const sparseMap = { thoughtUnits: [mapUnit("n_1", "Constraint")], connections: [] };
    state.activeElicitation = { kind: "sparse_map_next_card" };

    const out = await processTurn(
      state,
      "No AI words",
      organizeQuestionLLM("What exact wording do you want to carry forward as the next card?"),
      cfg,
      "chat",
      sparseMap,
    );

    expect(out.mode).toBe("question");
    expect(out.questionStance).toBe("deepen");
    expect(out.text).toBe(
      "I'm holding off on organizing this yet because the map is still too sparse. I can use 'No AI words' as the card wording. What part of that should we unpack first?",
    );
  });

  it("does not repeat exact-wording when the model asks it without organize metadata", async () => {
    const state = createState();
    state.activeElicitation = { kind: "sparse_map_next_card" };

    const out = await processTurn(
      state,
      "No AI words",
      questionLLM("What exact wording do you want to carry forward as the next card?"),
    );

    expect(out.mode).toBe("question");
    expect(out.questionStance).toBe("deepen");
    expect(out.text).toBe("I can use 'No AI words' as the card wording. What part of that should we unpack first?");
  });

  it("limits active-elicitation fast-path mirrors to the newly answered card instead of minting extra claims", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0, minReadyCandidatesToBatch: 1 });
    state.activeElicitation = { kind: "sparse_map_next_card" };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "No silent commit",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              { claimText: "No silent commit", utteranceIds: ["u_1"], userPhrase: "No silent commit" },
            ],
          },
          {
            id: "c2",
            text: "Constraint No silent commit",
            candidateId: "cand2",
            target: "idea",
            sourceSpans: [
              { claimText: "Constraint No silent commit", utteranceIds: ["u_2"], userPhrase: "Constraint No silent commit" },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "No silent commit", addEvidenceIds: ["u_1"] },
        { id: "cand2", target: "idea", gist: "Constraint No silent commit", addEvidenceIds: ["u_2"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "No silent commit", llm, cfg);

    expect(out.mode).toBe("mirror");
    expect(out.validatedMirror?.reflection.claims).toHaveLength(1);
    expect(out.validatedMirror?.reflection.claims[0].text).toBe("No silent commit");
  });

  it("asks separate-or-edit when a focused carry-forward mirror wraps an existing card", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0, minReadyCandidatesToBatch: 1 });
    const sparseMap = { thoughtUnits: [mapUnit("n_1", "No AI words")], connections: [] };
    state.activeElicitation = { kind: "sparse_map_next_card" };
    const userText = "No AI words-AI can only use writer's own word(chat input) to generate";
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: userText,
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [{ claimText: userText, utteranceIds: ["u_1"], userPhrase: userText }],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: userText, addEvidenceIds: ["u_1"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, userText, llm, cfg, "chat", sparseMap);

    expect(out.mode).toBe("clarify");
    // User-facing copy cites the #ref (never the internal unit id) and names
    // the exact edit command so the reword branch is actionable.
    expect(out.text).toBe(
      "That seems close to #1. Do you want this as a separate card, or should #1 be reworded? You can say: reword #1 to <your exact words>.",
    );
    expect(out.validatedMirror).toBeUndefined();
  });

  it("does not turn structural instruction wording into card text during active elicitation", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0, minReadyCandidatesToBatch: 1 });
    state.activeElicitation = { kind: "carry_forward" };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "No silent commit - this should be one of the main idea under Constraint",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "No silent commit - this should be one of the main idea under Constraint",
                utteranceIds: ["u_1"],
                userPhrase: "No silent commit - this should be one of the main idea under Constraint",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        {
          id: "cand1",
          target: "idea",
          gist: "No silent commit - this should be one of the main idea under Constraint",
          addEvidenceIds: ["u_1"],
        },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(
      state,
      "No silent commit-this should be one of the main idea under Constraint",
      llm,
      cfg,
    );

    expect(out.mode).toBe("clarify");
    expect(out.text).toBe(
      "I can hear the card wording inside that, but the rest sounds like instructions about where it fits. What exact wording should the card itself carry?",
    );
    expect(out.validatedMirror).toBeUndefined();
  });

  it("breaks a repeated exact-wording loop with an explicit carry-forward clarify", async () => {
    const state = createState();
    const repeat = organizeQuestionLLM("What exact wording do you want the map to carry forward from that?");

    state.activeElicitation = { kind: "carry_forward" };
    await processTurn(state, "No silent commit", repeat);
    const out = await processTurn(state, "No silent commit", repeat);

    expect(out.mode).toBe("clarify");
    expect(out.suppressionReason).toBe("capture_loop");
    expect(out.text).toContain("I think you're pointing at something to carry forward");
    expect(out.text).not.toContain("What exact wording do you want the map to carry forward from that?");
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

  it("lets a lone ready mirror attempt through batching when map pressure is high", async () => {
    // Same setup as the batch-preference test above, but with the slider leaning
    // on the map. A single ready candidate should reach the validator instead of
    // waiting for a second one to batch — validation, not batching, decides the
    // outcome. Guards the map-lean single-mirror relaxation in the batch gate.
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
      mapPressure: 0.5,
    });
    await processTurn(state, "I enjoy writing", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;

    const out = await processTurn(state, "yes", groundedMirrorLLM("I enjoy writing", uid), cfg);

    expect(out.mode).toBe("mirror");
    expect(out.pacingSuppressed).toBeUndefined();
    expect(out.suppressionReason).not.toBe("batch_preference");
  });

  it("lets high map pressure mirror a newly-ready candidate after the user's answer", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    expect(cfg.pacing.minQuestionTurnsBetweenMirrors).toBe(0);
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

  it("bridges to a mirror prompt when the LLM keeps deepening despite ready candidates", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
    });

    const out = await processTurn(
      state,
      "control means key decisions. visual state means layout choices.",
      mirrorPressureQuestionLLM(),
      cfg,
    );

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("mirror_pressure_bridge");
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toBe(
      "I think this may be close enough to reflect back. Do you want me to try mirroring the structure I'm hearing, or keep unpacking it?",
    );
  });

  it("uses an explicitly mentioned bare card ref in the mirror-pressure bridge", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
    });
    const map = { thoughtUnits: [mapUnit("tu_86", "Monitoring")], connections: [] };

    const out = await processTurn(
      state,
      "maybe monitoring in 86. control means key decisions.",
      mirrorPressureQuestionLLM(),
      cfg,
      "chat",
      map,
    );

    expect(out.suppressionReason).toBe("mirror_pressure_bridge");
    expect(out.text).toBe(
      "I think this may be close enough to reflect how this connects to #86. Do you want me to try mirroring that structure now, or keep unpacking it?",
    );
  });

  it("does not invent a card ref for the mirror-pressure bridge", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
    });
    const map = { thoughtUnits: [mapUnit("tu_86", "Monitoring")], connections: [] };

    const out = await processTurn(
      state,
      "control means key decisions. visual state means layout choices.",
      mirrorPressureQuestionLLM(),
      cfg,
      "chat",
      map,
    );

    expect(out.suppressionReason).toBe("mirror_pressure_bridge");
    expect(out.text).not.toContain("#86");
  });

  it("bridges a lone ready candidate only after a long no-mirror run", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 3,
      minReadyCandidatesToBatch: 2,
    });
    state.turnsSinceLastMirror = 6;

    const out = await processTurn(
      state,
      "control means key decisions",
      mirrorPressureQuestionLLM(),
      cfg,
    );

    expect(out.suppressionReason).toBe("mirror_pressure_bridge");
  });

  it("does not bridge when the user is stuck", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
    });

    const out = await processTurn(
      state,
      "not sure. control means key decisions.",
      mirrorPressureQuestionLLM("Which part feels easiest to point at right now?"),
      cfg,
    );

    expect(out.suppressionReason).not.toBe("mirror_pressure_bridge");
    expect(out.mode).toBe("clarify");
  });

  it("does not bridge on a large exploratory turn", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 1,
    });

    const out = await processTurn(
      state,
      "control matters. monitoring matters. visualization matters. authorship matters.",
      mirrorPressureQuestionLLM("Which one piece should we stay with first?"),
      cfg,
    );

    expect(out.suppressionReason).not.toBe("mirror_pressure_bridge");
    expect(out.text).toBe("Which one piece should we stay with first?");
  });

  it("lets command precedence win over mirror pressure", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 1,
    });

    const out = await processTurn(
      state,
      "Create a card with exactly this text: human control",
      mirrorPressureQuestionLLM(),
      cfg,
    );

    expect(out.suppressionReason).toBe("command_precedence");
    expect(out.mapCommands).toEqual([
      { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] },
    ]);
  });

  it("lets a valid mirror win over mirror pressure", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 1,
    });

    const out = await processTurn(
      state,
      "control means key decisions",
      groundedMirrorLLM("control means key decisions", "u_1"),
      cfg,
    );

    expect(out.mode).toBe("mirror");
    expect(out.suppressionReason).toBeUndefined();
  });

  it("lets a failed mirror validation win over mirror pressure", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 1,
    });

    const out = await processTurn(state, "running fast", driftingMirrorLLM("u_1"), cfg);

    expect(out.mode).toBe("clarify");
    expect(out.suppressionReason).toBe("validation_failed");
  });

  it("does not bridge over an active failed-mirror repair clarify", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
    });
    state.mode = "clarify";
    state.clarifyTarget = {
      claimText: "control",
      utteranceIds: ["u_seed"],
      userPhrase: "control",
    };

    const out = await processTurn(
      state,
      "control means key decisions. visual state means layout choices.",
      mirrorPressureClarifyLLM("What wording should change here?"),
      cfg,
    );

    expect(out.mode).toBe("clarify");
    expect(out.text).toBe("What wording should change here?");
    expect(out.suppressionReason).toBeUndefined();
    expect(state.activeElicitation).toEqual({
      kind: "clarify_after_failed_mirror",
      targetPhrase: "control",
    });
  });

  it("does not bridge over a blocked map command", async () => {
    const state = createState();
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 2,
    });
    const llm = (ctx: LLMContext): LLMTurn => {
      const latest = ctx.bank.slice(-2);
      return {
        mode: "question",
        text: "What does control actually mean here?",
        questionStance: "deepen",
        candidateUpserts: latest.map((unit, index) => ({
          id: `ready_${index + 1}`,
          target: "idea",
          gist: unit.text,
          addEvidenceIds: [unit.id],
        })),
        mapCommands: [
          {
            kind: "nest_card",
            childText: "human control",
            parentText: "missing parent",
          },
        ],
      };
    };

    const out = await processTurn(
      state,
      "control means key decisions. visual state means layout choices.",
      llm,
      cfg,
    );

    expect(out.suppressionReason).not.toBe("mirror_pressure_bridge");
    expect(out.text).toBe("What does control actually mean here?");
    expect(out.commandDebug?.some((note) => note.reason === "unresolved_reference")).toBe(true);
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
    expect(out.text).toContain("pointing at something to carry forward");
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

  it("blocks tentative mirrors toward Think and asks what would firm them up", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0, mapPressure: 0 });
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "I'm not fully sure yet human control matters",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "I'm not fully sure yet human control matters",
                utteranceIds: ["u_1"],
                userPhrase: "I'm not fully sure yet human control matters",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "not sure human control matters", addEvidenceIds: ["u_1"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "I'm not fully sure yet human control matters", llm, cfg);

    expect(out.mode).toBe("clarify");
    expect(out.text).toBe(
      "I think this may be something to carry forward, but it still sounds tentative - what would make it feel firm enough?",
    );
    expect(out.suppressionDetail).toContain("tentative_uncertainty");
    expect(out.validatedMirror).toBeUndefined();
  });

  it("does not re-grill a direct answer after a failed mirror clarify", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0 });
    const drifting = (_ctx: LLMContext): LLMTurn => ({
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
                utteranceIds: ["u_1"],
                userPhrase: "human control decides draft wording",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "human control decides draft wording", addEvidenceIds: ["u_1"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const first = await processTurn(state, "human control decides draft wording", drifting, cfg);
    expect(first.mode).toBe("clarify");

    const second = await processTurn(
      state,
      "human control decides draft wording",
      groundedMirrorLLM("human control decides draft wording", "u_2"),
      cfg,
    );

    expect(second.mode).toBe("mirror");
    expect(second.text).toBe(MIRROR_PREAMBLE);
  });

  it("returns to next-card capture when a sparse-map organize answer already supplied sibling framing", async () => {
    const state = createState();
    state.organizeFocus = { refs: ["#1", "#2"], key: "#1|#2", declineCount: 0 };
    const sparseMap = { thoughtUnits: [mapUnit("n_1", "Constraint")], connections: [] };

    const out = await processTurn(
      state,
      "there are no relationship between them, but they are both small idea under the big idea: Constraint",
      organizeQuestionLLM("Between #1 and #2, what relationship do you want to state?"),
      withQuestionIntentBias(defaultConfig, 100),
      "chat",
      sparseMap,
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe(
      "I'm holding off on organizing this yet because the map is still too sparse. What exact wording do you want to carry forward as the next card?",
    );
    expect(state.organizeFocus).toBeUndefined();
  });

  it("allows tentative mirrors toward Map when the uncertainty wording is preserved", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0, mapPressure: 1 });
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "I'm not fully sure yet human control matters",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "I'm not fully sure yet human control matters",
                utteranceIds: ["u_1"],
                userPhrase: "I'm not fully sure yet human control matters",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "not sure human control matters", addEvidenceIds: ["u_1"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "I'm not fully sure yet human control matters", llm, cfg);

    expect(out.mode).toBe("mirror");
    expect(out.validatedMirror?.reflection.claims[0].text).toBe("I'm not fully sure yet human control matters");
  });

  it("blocks tentative mirrors toward Map when uncertainty wording is dropped", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0, mapPressure: 1 });
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "human control matters",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [
              {
                claimText: "human control matters",
                utteranceIds: ["u_1"],
                userPhrase: "human control matters",
              },
            ],
          },
        ],
      },
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "not sure human control matters", addEvidenceIds: ["u_1"] },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, "I'm not fully sure yet human control matters", llm, cfg);

    expect(out.mode).toBe("clarify");
    expect(out.suppressionDetail).toContain("tentative_uncertainty");
    expect(out.validatedMirror).toBeUndefined();
  });

  it("downgrades mirror attempts from large exploratory turns to a focusing question", async () => {
    const state = createState();
    const userText =
      "The opening is about control. The middle is about authorship. The ending needs a contrast. I am still exploring what matters most.";
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      mirror: {
        claims: [
          {
            id: "c1",
            text: "control matters",
            candidateId: "cand1",
            target: "idea",
            sourceSpans: [{ claimText: "control matters", utteranceIds: ["u_1"], userPhrase: "control" }],
          },
        ],
      },
    });

    const out = await processTurn(state, userText, llm);

    expect(out.mode).toBe("question");
    expect(out.text).toBe(
      "I'm treating that as a big exploratory dump, so I want to help you choose one piece rather than harvest it. Which one piece of that should we stay with first?",
    );
    expect(out.suppressionReason).toBe("large_exploratory_turn");
    expect(out.validatedMirror).toBeUndefined();
  });

  it("drops many broad idea upserts from large exploratory turns", async () => {
    const state = createState();
    const userText =
      "The opening is about control. The middle is about authorship. The ending needs a contrast. I am still exploring what matters most.";
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Which one piece should we stay with first?",
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "control", addEvidenceIds: ["u_1"] },
        { id: "cand2", target: "idea", gist: "authorship", addEvidenceIds: ["u_2"] },
        { id: "cand3", target: "idea", gist: "contrast", addEvidenceIds: ["u_3"] },
      ],
    });

    const out = await processTurn(state, userText, llm);

    expect(state.candidates.getAll()).toHaveLength(0);
    expect(state.openThreads.map((thread) => thread.text)).toEqual([
      "The opening is about control.",
      "The middle is about authorship.",
      "The ending needs a contrast.",
      "I am still exploring what matters most.",
    ]);
    expect(out.commandDebug).toEqual([
      {
        reason: "large_turn_candidate_filter",
        detail: "dropped 3 broad idea candidate(s) from exploratory turn",
      },
    ]);
  });

  it("does not surface parked threads on ordinary unrelated turns", async () => {
    const state = createState();
    await processTurn(
      state,
      "The opening is about control. The middle is about authorship. The ending needs a contrast. I am still exploring what matters most.",
      questionLLM("Which one piece should we stay with first?"),
    );

    let capturedCtx: LLMContext | undefined;
    await processTurn(state, "the new issue is reader trust", (ctx) => {
      capturedCtx = ctx;
      return { mode: "question", text: "What makes reader trust matter?" };
    });

    expect(capturedCtx?.openThreads).toBeUndefined();
  });

  it("surfaces parked threads when the user asks what to do next", async () => {
    const state = createState();
    await processTurn(
      state,
      "The opening is about control. The middle is about authorship. The ending needs a contrast. I am still exploring what matters most.",
      questionLLM("Which one piece should we stay with first?"),
    );

    let capturedCtx: LLMContext | undefined;
    await processTurn(state, "what should we do next", (ctx) => {
      capturedCtx = ctx;
      return { mode: "question", text: "Which one still feels live?" };
    });

    expect(capturedCtx?.openThreads?.map((thread) => thread.text)).toContain("The ending needs a contrast.");
  });

  it("activates a matching parked thread and bounds selected-strand context to it", async () => {
    const state = createState();
    await processTurn(
      state,
      "The opening is about control. The middle is about authorship. The ending needs a contrast. I am still exploring what matters most.",
      questionLLM("Which one piece should we stay with first?"),
    );

    let capturedCtx: LLMContext | undefined;
    await processTurn(state, "I want to talk about authorship", (ctx) => {
      capturedCtx = ctx;
      return { mode: "question", text: "What about authorship feels live?" };
    });

    expect(state.openThreads.find((thread) => thread.text === "The middle is about authorship.")?.status).toBe("active");
    expect(capturedCtx?.activeSelectionContext?.sourceUtteranceIds).toEqual(["u_2"]);
  });

  it("does not activate a parked thread from an ordinary answer that merely shares a word", async () => {
    const state = createState();
    await processTurn(
      state,
      "The opening is about control. The middle is about authorship. The ending needs a contrast. I am still exploring what matters most.",
      questionLLM("Which one piece should we stay with first?"),
    );

    // Substantive answer, not a return/pivot-shaped turn — it shares the word
    // "authorship" with a parked thread (0.5 overlap on a 2-token thread), but
    // must not activate it or retarget the bounded selection context.
    await processTurn(
      state,
      "authorship feels heavier than control in my everyday writing",
      questionLLM("Say more about that?"),
    );

    expect(state.openThreads.some((thread) => thread.status === "active")).toBe(false);
  });

  it("keeps a single idea upsert from a large exploratory turn as non-structural evidence", async () => {
    const state = createState();
    const userText =
      "The opening is about control. The middle is about authorship. The ending needs a contrast. I am still exploring what matters most.";
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Which one piece should we stay with first?",
      candidateUpserts: [
        { id: "cand1", target: "idea", gist: "control", addEvidenceIds: ["u_1"] },
      ],
    });

    const out = await processTurn(state, userText, llm);

    expect(state.candidates.getAll()).toEqual([
      expect.objectContaining({
        id: "cand1",
        target: "idea",
        evidenceUtteranceIds: ["u_1"],
      }),
    ]);
    expect(out.commandDebug).toBeUndefined();
    expect(out.validatedMirror).toBeUndefined();
  });

  it("allows large selected turns to use existing carry-forward validation", async () => {
    const state = createState();
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0 });
    const userText =
      "I am walking through context. The main idea is human control decides what enters the draft. I still need examples. The conclusion can come later.";
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
                utteranceIds: ["u_2"],
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
          addEvidenceIds: ["u_2"],
        },
      ],
      carryForwardCandidateIds: ["cand1"],
    });

    const out = await processTurn(state, userText, llm, cfg);

    expect(out.mode).toBe("mirror");
    expect(out.validatedMirror?.reflection.claims[0].text).toBe("human control decides what enters the draft");
  });

  it("still requires exact current-turn wording for LLM commands inside large turns", async () => {
    const state = createState();
    const userText =
      "There is a lot here. I'd like human control as a card. The ending needs more pressure. I may still change the frame.";
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Which card should we place?",
      mapCommands: [
        {
          kind: "create_card",
          text: "AI control",
          sourceSpan: { utteranceIds: ["u_2"], userPhrase: "AI control" },
        },
      ],
    });

    const out = await processTurn(state, userText, llm);

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "not_current_turn_span")).toBe(true);
  });

  it("lets full map pressure remove the first-turn cooldown without bypassing other gates", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    expect(cfg.pacing.minQuestionTurnsBetweenMirrors).toBe(0);
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
    expect(out.suppressionReason).not.toBe("cooldown");
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

  it("can continue the coach turn without growing the source bank", async () => {
    const state = createState();
    await processTurn(state, "first utterance", questionLLM("Q1"));
    const before = state.bank.getAll();
    let capturedCtx: LLMContext | undefined;
    const captureLLM = (ctx: LLMContext): LLMTurn => {
      capturedCtx = ctx;
      return { mode: "question", text: "Q2" };
    };

    await processTurn(
      state,
      "",
      captureLLM,
      defaultConfig,
      "chat",
      { thoughtUnits: [], connections: [] },
      { ingestUser: false },
    );

    expect(state.bank.getAll()).toEqual(before);
    expect(capturedCtx?.bank).toEqual(before);
    expect(capturedCtx?.turnText).toBe("");
    expect(capturedCtx?.turnShape.kind).toBe("compact");
  });

  it("passes draft declarations as suppression-only context", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";
    let capturedCtx: LLMContext | undefined;
    const captureLLM = (ctx: LLMContext): LLMTurn => {
      capturedCtx = ctx;
      return { mode: "question", text: "What tension does that create?" };
    };

    await processTurn(state, "what should I do next?", captureLLM);

    expect(capturedCtx?.draftDeclarations).toEqual([
      expect.objectContaining({
        kind: "main_idea",
        text: "human control decides what enters the draft",
      }),
    ]);
    expect(state.candidates.getAll()).toHaveLength(0);
    expect(state.bank.getAll()).toHaveLength(1);
    expect(state.bank.getAll()[0].text).toBe("what should I do next?");
  });

  it("does not let draft declarations become mirror evidence", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0 });
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "mirror",
      text: "ready",
      candidateUpserts: [
        {
          id: "draft_claim",
          target: "idea",
          gist: "human control decides what enters the draft",
          addEvidenceIds: ["u_1"],
        },
      ],
      mirror: {
        claims: [
          {
            id: "c1",
            candidateId: "draft_claim",
            target: "idea",
            text: "human control decides what enters the draft",
            sourceSpans: [
              {
                claimText: "human control decides what enters the draft",
                utteranceIds: ["u_1"],
                userPhrase: "human control decides what enters the draft",
              },
            ],
          },
        ],
      },
    });

    const out = await processTurn(state, "what should I do next?", llm, cfg);

    expect(out.mode).toBe("clarify");
    expect(out.validatedMirror).toBeUndefined();
    expect(out.mapCommands).toBeUndefined();
    expect(state.bank.getAll()).toHaveLength(1);
    expect(state.bank.getAll()[0].text).toBe("what should I do next?");
  });

  it("bridges an explicit list of possible cards under a user-named card", async () => {
    const state = createState();
    const map = { thoughtUnits: [mapUnit("tu_86", "Monitoring")], connections: [] };

    const out = await processTurn(
      state,
      [
        "maybe monitoring in 86",
        "I am thinking about control I have in mind:",
        "visualization, monitoring and control,",
        "I am considering making the three into cards under the 86 card",
      ].join("\n"),
      questionLLM("When you say control, what does control actually mean here?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("draft_salience_bridge");
    expect(out.text).toBe(
      "I hear three possible cards under #86: visualization, monitoring, and control. Do you want to place those as separate cards, or unpack one first?",
    );
    expect(out.questionStance).toBe("organize");
    expect(out.mapCommands).toBeUndefined();
  });

  it("bridges an explicit list when the only ref phrasing is under the numbered card", async () => {
    const state = createState();
    const map = { thoughtUnits: [mapUnit("tu_86", "Monitoring")], connections: [] };

    const out = await processTurn(
      state,
      "I have in mind: visualization, monitoring and control. I am considering making the three into cards under the 86 card.",
      questionLLM("When you say control, what does control actually mean here?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("draft_salience_bridge");
    expect(out.text).toBe(
      "I hear three possible cards under #86: visualization, monitoring, and control. Do you want to place those as separate cards, or unpack one first?",
    );
    expect(out.mapCommands).toBeUndefined();
  });

  it("does not bridge a negated explicit list placement", async () => {
    const state = createState();
    const map = { thoughtUnits: [mapUnit("tu_86", "Monitoring")], connections: [] };

    const out = await processTurn(
      state,
      "I do not want visualization, monitoring, and control as cards under the 86 card.",
      questionLLM("What should we leave out?"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.suppressionReason).not.toBe("draft_salience_bridge");
    expect(out.text).toBe("What should we leave out?");
    expect(out.mapCommands).toBeUndefined();
  });

  it("uses draft-backed salience as a map-carry bridge when map pressure is high", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";
    const cfg = withQuestionIntentBias(defaultConfig, 100);

    const out = await processTurn(
      state,
      "human control is about deciding what enters the draft",
      questionLLM("What does human control mean here?"),
      cfg,
    );

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("draft_salience_bridge");
    expect(out.text).toBe(
      'This seems connected to the draft idea "human control decides what enters the draft". Do you want to carry that toward the map, or keep refining it first?',
    );
    expect(out.questionAnchor).toBe("The main idea is human control decides what enters the draft");
    expect(out.questionStance).toBe("organize");
    expect(out.mapCommands).toBeUndefined();
  });

  it("uses draft-backed salience as a sharpening question when map pressure is low", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";
    const cfg = withQuestionIntentBias(defaultConfig, 0);

    const out = await processTurn(
      state,
      "human control is about deciding what enters the draft",
      questionLLM("What does human control mean here?"),
      cfg,
    );

    expect(out.mode).toBe("question");
    expect(out.suppressionReason).toBe("draft_salience_bridge");
    expect(out.text).toBe(
      'What part of "human control decides what enters the draft" feels most important to unpack first?',
    );
    expect(out.questionAnchor).toBe("The main idea is human control decides what enters the draft");
    expect(out.questionStance).toBe("deepen");
    expect(out.mapCommands).toBeUndefined();
  });

  it("does not use weak draft overlap as salience", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";
    const cfg = withQuestionIntentBias(defaultConfig, 100);

    const out = await processTurn(
      state,
      "what should I do next?",
      questionLLM("Which part feels most important next?"),
      cfg,
    );

    expect(out.suppressionReason).not.toBe("draft_salience_bridge");
    expect(out.text).toBe("Which part feels most important next?");
  });

  it("lets direct map commands win over draft-backed salience", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";
    const cfg = withQuestionIntentBias(defaultConfig, 100);

    const out = await processTurn(
      state,
      "make a card called human control decides what enters the draft",
      questionLLM("What does human control mean here?"),
      cfg,
    );

    expect(out.suppressionReason).toBe("command_precedence");
    expect(out.mapCommands).toEqual([
      expect.objectContaining({
        kind: "create_card",
        text: "human control decides what enters the draft",
      }),
    ]);
  });

  it("re-angles redundant main-idea questions when the draft already declares one", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";

    const out = await processTurn(
      state,
      "what should I do next?",
      questionLLM("What is the main idea?"),
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe(
      'What tension or consequence in "human control decides what enters the draft" feels most important to examine next?',
    );
    expect(out.questionAnchor).toBe("The main idea is human control decides what enters the draft");
    expect(out.questionStance).toBe("deepen");
    expect(state.candidates.getAll()).toHaveLength(0);
    expect(state.bank.getAll()).toHaveLength(1);
  });

  it("re-angles redundant main-idea questions for clearly repeated draft focus", async () => {
    const state = createState();
    state.draft =
      "Human control decides what enters the draft. A scene follows. Human control decides what enters the draft. Another note. Human control decides what enters the draft.";

    const out = await processTurn(
      state,
      "what should I do next?",
      questionLLM("What's the central idea?"),
    );

    expect(out.mode).toBe("question");
    expect(out.text).toContain("What tension or consequence");
    expect(out.text).toContain("Human control decides what enters the draft");
    expect(out.questionAnchor).toBe("Human control decides what enters the draft.");
    expect(state.candidates.getAll()).toHaveLength(0);
    expect(state.bank.getAll()).toHaveLength(1);
  });

  it("leaves a sharp deepen question alone even when the draft has a declared focus", async () => {
    const state = createState();
    state.draft = "The main idea is human control decides what enters the draft.";

    const out = await processTurn(
      state,
      "what should I do next?",
      questionLLM("What part of your main argument is weakest?"),
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe("What part of your main argument is weakest?");
    expect(out.questionAnchor).toBeUndefined();
  });

  it("leaves main-idea questions alone when the draft has no declared focus", async () => {
    const state = createState();
    state.draft = "A loose opening paragraph about control and writing tools.";

    const out = await processTurn(
      state,
      "what should I do next?",
      questionLLM("What is the main idea?"),
    );

    expect(out.mode).toBe("question");
    expect(out.text).toBe("What is the main idea?");
    expect(out.questionAnchor).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Map-aware questioning + answer transitions (Goals 4 & 5)
// ---------------------------------------------------------------------------

describe("map-aware questioning (Goal 4)", () => {
  const mapWith = (units: ThoughtUnit[], connections: LLMMapContext["connections"] = []): LLMMapContext => ({
    thoughtUnits: units,
    connections,
  });

  it("passes read-only map question anchors (ref, text, neighbors) in LLM context", async () => {
    const state = createState();
    const map = mapWith(
      [mapUnit("tu_86", "monitoring"), mapUnit("tu_166", "control"), mapUnit("tu_9", "draft")],
      [
        {
          id: "conn1",
          sourceId: "tu_86",
          targetId: "tu_166",
          labelUnitId: "lu1",
          labelText: "",
          sourceText: "monitoring",
          targetText: "control",
          utteranceIds: [],
        },
      ],
    );
    let captured: LLMContext | undefined;
    const capturingLLM = (ctx: LLMContext): LLMTurn => {
      captured = ctx;
      return { mode: "question", text: "Q" };
    };

    await processTurn(state, "let's look at this", capturingLLM, defaultConfig, "chat", map);

    const anchors = captured?.mapQuestionContext ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    const monitoring = anchors.find((a) => a.ref === "#86");
    expect(monitoring?.text).toBe("monitoring");
    expect(monitoring?.neighbors.map((n) => n.ref)).toContain("#166");
  });

  it("does not emit map commands when the coach references a card in a question", async () => {
    const state = createState();
    const map = mapWith([
      mapUnit("tu_86", "monitoring"),
      mapUnit("tu_9", "draft"),
      mapUnit("tu_10", "idea"),
    ]);
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "How does that relate to #86?",
      questionStance: "organize",
    });

    const out = await processTurn(
      state,
      "here's my point about control",
      llm,
      withQuestionIntentBias(defaultConfig, 100),
      "chat",
      map,
    );

    expect(out.mode).toBe("question");
    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("#86");
  });

  it("does not arm relationship capture for a read-only two-ref comparison question", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    const map = mapWith([
      mapUnit("tu_86", "monitoring"),
      mapUnit("tu_166", "control"),
      mapUnit("tu_9", "draft"),
    ]);

    await processTurn(
      state,
      "I am thinking about control",
      organizeQuestionLLM("Which feels closer to this idea, #86 or #166?"),
      cfg,
      "chat",
      map,
    );
    expect(state.organizeFocus).toBeUndefined();

    let called = false;
    const out = await processTurn(
      state,
      "monitoring",
      () => {
        called = true;
        return organizeQuestionLLM("What makes monitoring important here?")({} as LLMContext);
      },
      cfg,
      "chat",
      map,
    );

    expect(called).toBe(true);
    expect(out.commandConfirmation?.kind).not.toBe("relationship_confirmation");
    expect(out.text).toBe("What makes monitoring important here?");
  });

  it("still allows a deepen question under low map pressure", async () => {
    const state = createState();
    const out = await processTurn(
      state,
      "I like writing",
      questionLLM("What does writing let you work out?"),
      defaultConfig,
    );
    expect(out.mode).toBe("question");
    expect(out.text).toBe("What does writing let you work out?");
  });
});

describe("answer transitions (Goal 5)", () => {
  const CONTROL_ANSWER = "Control means the human decides which ideas enter the draft";

  it("does not re-ask an answered question in reworded form (think pressure settles forward)", async () => {
    const state = createState();
    const cfg = defaultConfig; // map pressure 0
    await processTurn(state, "I want to think about control", questionLLM("What does control mean here?"), cfg);
    expect(state.lastCoachQuestion?.text).toBe("What does control mean here?");

    const reAsk = "What does control actually mean here?";
    const out = await processTurn(state, CONTROL_ANSWER, deepenLLM(reAsk), cfg);

    expect(out.text).not.toBe(reAsk);
    expect(out.questionStance).toBe("settle");
  });

  it("steers an answered question toward a map-aware bridge under high map pressure", async () => {
    const state = createState();
    const cfg = withQuestionIntentBias(defaultConfig, 100);
    const map = {
      thoughtUnits: [mapUnit("tu_86", "monitoring"), mapUnit("tu_166", "control"), mapUnit("tu_9", "draft")],
      connections: [],
    };
    await processTurn(state, "let's dig into control", questionLLM("What does control mean here?"), cfg, "chat", map);

    const reAsk = "What does control actually mean here?";
    const out = await processTurn(state, CONTROL_ANSWER, deepenLLM(reAsk), cfg, "chat", map);

    expect(out.text).not.toBe(reAsk);
    expect(out.text).toContain("belong with something already on your map");
    expect(out.questionStance).toBe("organize");
    expect(out.mapCommands).toBeUndefined();
  });

  it("allows a genuinely new-concept follow-up after an answer (no over-trigger)", async () => {
    const state = createState();
    const cfg = defaultConfig;
    await processTurn(state, "let's think about control", questionLLM("What does control mean here?"), cfg);

    const newConcept = "What makes visibility different from tracing?";
    const out = await processTurn(state, CONTROL_ANSWER, deepenLLM(newConcept), cfg);

    expect(out.text).toBe(newConcept);
  });

  it("routes a not-sure reply to stuck handling, not the answer transition", async () => {
    const state = createState();
    const cfg = defaultConfig;
    await processTurn(state, "let's think about control", questionLLM("What does control mean here?"), cfg);

    const out = await processTurn(state, "I'm not sure", questionLLM("What does control actually mean here?"), cfg);

    expect(out.mode).toBe("clarify");
  });

  it("clears the last-question anchor after a direct command (no stale answer detection)", async () => {
    const state = createState();
    const cfg = defaultConfig;
    await processTurn(state, "let's think about control", deepenLLM("What does control mean here?"), cfg);
    expect(state.lastCoachQuestion?.text).toBe("What does control mean here?");

    // A direct command interlude must not leave the deepen question as the anchor.
    const out = await processTurn(
      state,
      "Create a card with exactly this text: human control",
      questionLLM("ignored"),
      cfg,
    );
    expect(out.mapCommands?.length).toBeGreaterThan(0);
    expect(state.lastCoachQuestion?.text).not.toBe("What does control mean here?");
  });

  it("does not flag a command-like turn as an answer (no ADVANCE contamination)", async () => {
    const state = createState();
    const cfg = defaultConfig;
    await processTurn(state, "let's think about control", deepenLLM("What does control mean here?"), cfg);

    let captured: LLMContext | undefined;
    const capturingLLM = (ctx: LLMContext): LLMTurn => {
      captured = ctx;
      return { mode: "question", text: "Q" };
    };
    await processTurn(state, "Create a card with exactly this text: human control", capturingLLM, cfg);

    expect(captured?.userAnsweredLastQuestion).toBeFalsy();
  });

  it("does not flag a loose make-card command as an answer", async () => {
    const state = createState();
    const cfg = defaultConfig;
    await processTurn(state, "let's think about control", deepenLLM("What does control mean here?"), cfg);

    let captured: LLMContext | undefined;
    const capturingLLM = (ctx: LLMContext): LLMTurn => {
      captured = ctx;
      return { mode: "question", text: "Q" };
    };
    await processTurn(state, "make the control point a card", capturingLLM, cfg);

    expect(captured?.userAnsweredLastQuestion).toBeFalsy();
  });

  it("tracks deterministic coverage questions as the last coach question", async () => {
    const state = createState();
    const map = {
      thoughtUnits: [mapUnit("tu_46", "Different style of AI use that enables user control")],
      connections: [],
    };

    await processTurn(
      state,
      "is there any major point the current card #46 doesn't cover?",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(state.lastCoachQuestion?.text).toContain("#46");
    expect(state.lastCoachQuestion?.stance).toBe("narrow");
  });

  it("does not mark an unrelated substantive pivot as an answer to the last question", async () => {
    const state = createState();
    const cfg = defaultConfig;
    await processTurn(state, "let's think about control", deepenLLM("What does control mean here?"), cfg);

    let captured: LLMContext | undefined;
    const capturingLLM = (ctx: LLMContext): LLMTurn => {
      captured = ctx;
      return { mode: "question", text: "Q" };
    };
    await processTurn(state, "I want to talk about monitoring instead", capturingLLM, cfg);

    expect(captured?.userAnsweredLastQuestion).toBeFalsy();
  });
});

describe("user next-move override (Under the Hood)", () => {
  const overrideMap = {
    thoughtUnits: [
      mapUnit("tu_86", "monitoring becomes active control"),
      mapUnit("tu_166", "control means the writer decides"),
    ],
    connections: [],
  };

  function capture(): { llm: (ctx: LLMContext) => LLMTurn; get: () => LLMContext | undefined } {
    let captured: LLMContext | undefined;
    return {
      llm: (ctx: LLMContext): LLMTurn => {
        captured = ctx;
        return { mode: "question", text: "Where would you like to go?", questionStance: "settle" };
      },
      get: () => captured,
    };
  }

  it("forwards the chosen mode to the model as forcedMode", async () => {
    const state = createState();
    const cap = capture();
    await processTurn(state, "", cap.llm, defaultConfig, "chat", overrideMap, {
      ingestUser: false,
      overrideMode: "deepen",
    });
    expect(cap.get()?.forcedMode).toBe("deepen");
  });

  it("forwards selected UI focus to the model without adding source-bank evidence", async () => {
    const state = createState();
    const cap = capture();
    await processTurn(state, "", cap.llm, defaultConfig, "chat", overrideMap, {
      ingestUser: false,
      overrideMode: "deepen",
      selectedFocus: {
        cards: [{ id: "tu_86", ref: "#86", text: "human control decides the wording", role: "node" }],
        draftText: "this paragraph argues for human control",
      },
    });

    expect(cap.get()?.selectedFocus).toEqual({
      cards: [{ id: "tu_86", ref: "#86", text: "human control decides the wording", role: "node" }],
      draftText: "this paragraph argues for human control",
    });
    expect(cap.get()?.bank).toEqual([]);
    expect(cap.get()?.forcedMode).toBe("deepen");
  });

  it("does not let selected map text become permission for a model-authored card", async () => {
    const state = createState();
    const out = await processTurn(
      state,
      "",
      () => ({
        mode: "question",
        text: "I'll ask about that.",
        mapCommands: [
          {
            kind: "create_card",
            text: "human control decides the wording",
            sourceSpan: { userPhrase: "human control decides the wording", utteranceIds: [] },
          },
        ],
      }),
      defaultConfig,
      "chat",
      overrideMap,
      {
        ingestUser: false,
        overrideMode: "deepen",
        selectedFocus: {
          cards: [{ id: "tu_86", ref: "#86", text: "human control decides the wording", role: "node" }],
        },
      },
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "not_current_turn_span")).toBe(true);
  });

  it("does not force a mode on an ordinary typed turn", async () => {
    const state = createState();
    const cap = capture();
    await processTurn(state, "I want to write about control", cap.llm, defaultConfig, "chat", overrideMap);
    expect(cap.get()?.forcedMode).toBeUndefined();
  });

  it("clears a wedged pending confirmation when a mode is forced", async () => {
    const state = createState();
    state.pendingMapCommand = {
      kind: "relationship_confirmation",
      labelText: "mirror",
      command: {
        kind: "connect_cards",
        source: { id: "tu_86" },
        target: { id: "tu_166" },
        labelText: "mirror",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "It sounds like you want the relationship wording to be 'mirror'. Is that right?",
      debug: "relationship_confirmation_pending",
    };
    const cap = capture();
    await processTurn(state, "", cap.llm, defaultConfig, "chat", overrideMap, {
      ingestUser: false,
      overrideMode: "mirror",
    });
    expect(state.pendingMapCommand).toBeUndefined();
    expect(cap.get()?.forcedMode).toBe("mirror");
  });

  it("pivot drops the last coach question and clarify pin so the model can't re-anchor", async () => {
    const state = createState();
    state.lastCoachQuestion = { text: "Which part feels easiest to point at?", stance: "settle" };
    state.clarifyTarget = { claimText: "giving back", utteranceIds: ["u_1"], userPhrase: "giving back" };
    const cap = capture();
    await processTurn(state, "", cap.llm, defaultConfig, "chat", overrideMap, {
      ingestUser: false,
      overrideMode: "pivot",
    });
    // The model must not see the stale question/pin it is being asked to escape.
    expect(cap.get()?.lastCoachQuestion).toBeUndefined();
    expect(cap.get()?.clarifyTarget).toBeUndefined();
    expect(cap.get()?.forcedMode).toBe("pivot");
  });

  it("does not let the anti-repeat settle guard override a forced deepen click", async () => {
    const state = createState();
    const staleSettle = "Let's ease off that one - what's one small part of this you already feel sure about?";
    state.lastAiText = staleSettle;
    state.prevAiText = "Which part feels easiest to name first?";

    const out = await processTurn(
      state,
      "",
      () => ({ mode: "question", text: staleSettle, questionStance: "settle" }),
      defaultConfig,
      "chat",
      overrideMap,
      { ingestUser: false, overrideMode: "deepen" },
    );

    expect(out.mode).toBe("question");
    expect(out.questionStance).toBe("deepen");
    expect(out.text).toBe("What should we unpack more deeply about the idea you were just working on?");
  });

  it("treats keep unpacking as choosing the non-mirror branch of a mirror-pressure bridge", async () => {
    const state = createState();
    state.lastAiText =
      "I think this may be close enough to reflect back. Do you want me to try mirroring the structure I'm hearing, or keep unpacking it?";
    const cfg = noReadinessCfg({
      minQuestionTurnsBetweenMirrors: 0,
      minReadyCandidatesToBatch: 1,
    });

    const out = await processTurn(
      state,
      "keep unpacking",
      mirrorPressureQuestionLLM(
        "I think this may be close enough to reflect back. Do you want me to try mirroring the structure I'm hearing, or keep unpacking it?",
      ),
      cfg,
      "chat",
      overrideMap,
    );

    expect(out.suppressionReason).not.toBe("mirror_pressure_bridge");
    expect(out.questionStance).toBe("deepen");
    expect(out.text).toBe("What should we unpack more deeply about the idea you were just working on?");
  });

  it("normalizes a forced organize click when the model returns a settle question", async () => {
    const state = createState();

    const out = await processTurn(
      state,
      "",
      () => ({
        mode: "question",
        text: "Let's ease off that one - what's one small part of this you already feel sure about?",
        questionStance: "settle",
      }),
      defaultConfig,
      "chat",
      overrideMap,
      { ingestUser: false, overrideMode: "organize" },
    );

    expect(out.mode).toBe("question");
    expect(out.questionStance).toBe("organize");
    expect(out.text).toBe("Which two ideas should we relate first, in your own words?");
  });

  it("does not allow a forced organize click to enter the mirror path", async () => {
    const state = createState();
    state.turnsSinceLastMirror = 99;

    const out = await processTurn(
      state,
      "",
      groundedMirrorLLM("control means writer decisions", "u_fake"),
      noReadinessCfg(),
      "chat",
      overrideMap,
      { ingestUser: false, overrideMode: "organize" },
    );

    expect(out.mode).toBe("question");
    expect(out.validatedMirror).toBeUndefined();
    expect(out.questionStance).toBe("organize");
    expect(out.text).toBe("Which two ideas should we relate first, in your own words?");
  });

  it("normalizes a forced pivot click when the model repeats the stale question", async () => {
    const state = createState();
    const stale = "Which focused point for this section feels easiest to name first?";
    state.lastAiText = stale;
    state.lastCoachQuestion = { text: stale, stance: "settle" };

    const out = await processTurn(
      state,
      "",
      () => ({ mode: "question", text: stale, questionStance: "settle" }),
      defaultConfig,
      "chat",
      overrideMap,
      { ingestUser: false, overrideMode: "pivot" },
    );

    expect(out.mode).toBe("question");
    expect(out.questionStance).toBe("settle");
    expect(out.text).toBe("Okay - let's leave that aside. Where would you like to point next?");
  });

  it("does not allow a forced pivot click to enter the mirror path", async () => {
    const state = createState();
    state.turnsSinceLastMirror = 99;

    const out = await processTurn(
      state,
      "",
      groundedMirrorLLM("control means writer decisions", "u_fake"),
      noReadinessCfg(),
      "chat",
      overrideMap,
      { ingestUser: false, overrideMode: "pivot" },
    );

    expect(out.mode).toBe("question");
    expect(out.validatedMirror).toBeUndefined();
    expect(out.questionStance).toBe("settle");
    expect(out.text).toBe("Okay - let's leave that aside. Where would you like to point next?");
  });
});

describe("bug pass: cancel-vs-correction disambiguation", () => {
  const relMap = {
    thoughtUnits: [
      mapUnit("tu_1", "supports the main claim"),
      mapUnit("tu_2", "the main claim"),
    ],
    connections: [],
  };

  function pendingRelationship() {
    return {
      kind: "relationship_confirmation" as const,
      labelText: "causes",
      command: {
        kind: "connect_cards" as const,
        source: { id: "tu_1" },
        target: { id: "tu_2" },
        labelText: "causes",
        labelSourceUtteranceIds: ["u_label"],
      },
      prompt: "It sounds like you want the relationship wording to be 'causes'. Is that right?",
      debug: "relationship_confirmation_pending",
    };
  }

  function correctedLabel(state: ReturnType<typeof createState>): string | undefined {
    const pending = state.pendingMapCommand;
    return pending?.kind === "relationship_confirmation" ? pending.labelText : undefined;
  }

  it("treats 'I meant supports, not causes' as a label correction, not a cancel", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    const out = await processTurn(
      state,
      "I meant supports, not causes",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      relMap,
    );

    expect(out.commandDebug?.some((n) => n.reason === "relationship_cancelled")).toBe(false);
    // Not dropped, and Y ("causes") matches the pending label, so X ("supports")
    // is taken as the corrected wording — not the whole sentence.
    expect(correctedLabel(state)).toBe("supports");
  });

  it("does not guess from 'I meant X, not Y' when Y is not the pending label", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(
      state,
      "I meant supports, not the roundabout",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      relMap,
    );

    // Y ("the roundabout") is not the pending label ("causes"), so we must not
    // guess "supports"; the raw text is kept for the user to re-confirm.
    expect(correctedLabel(state)).not.toBe("supports");
    expect(correctedLabel(state)).toBe("I meant supports, not the roundabout");
  });

  it("still cancels when the negation targets the action ('not connect them')", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    const out = await processTurn(
      state,
      "I meant to point at it, not connect them",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      relMap,
    );

    expect(out.commandDebug?.some((n) => n.reason === "relationship_cancelled")).toBe(true);
    expect(state.pendingMapCommand).toBeUndefined();
  });

  it("treats 'No, the relationship label should be supports' as a correction, not a cancel", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    const out = await processTurn(
      state,
      "No, the relationship label should be supports",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      relMap,
    );

    expect(out.commandDebug?.some((n) => n.reason === "relationship_cancelled")).toBe(false);
    expect(correctedLabel(state)).toBe("supports");
  });

  it("treats 'No, the connection label should be supports instead' as a correction, not a cancel", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    const out = await processTurn(
      state,
      "No, the connection label should be supports instead",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      relMap,
    );

    expect(out.commandDebug?.some((n) => n.reason === "relationship_cancelled")).toBe(false);
    expect(correctedLabel(state)).toBe("supports");
  });

  it("extracts the wording from a bare 'the label should be X' correction", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(state, "the label should be supports", questionLLM("ignored"), defaultConfig, "chat", relMap);

    expect(correctedLabel(state)).toBe("supports");
  });

  it("extracts the wording from a 'use X instead' correction", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(state, "use supports instead", questionLLM("ignored"), defaultConfig, "chat", relMap);

    expect(correctedLabel(state)).toBe("supports");
  });

  it("keeps a plain wording reply as the label verbatim", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(state, "supports", questionLLM("ignored"), defaultConfig, "chat", relMap);

    expect(correctedLabel(state)).toBe("supports");
  });

  it("extracts the wording from a bare 'it should be X' correction", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(state, "No, it should be supports", questionLLM("ignored"), defaultConfig, "chat", relMap);

    expect(correctedLabel(state)).toBe("supports");
  });

  it("extracts X from 'I meant X instead of Y' when Y is the pending label", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(state, "I meant supports instead of causes", questionLLM("ignored"), defaultConfig, "chat", relMap);

    expect(correctedLabel(state)).toBe("supports");
  });

  it("extracts X from 'I mean X rather than Y' when Y is the pending label", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(state, "I mean supports rather than causes", questionLLM("ignored"), defaultConfig, "chat", relMap);

    expect(correctedLabel(state)).toBe("supports");
  });

  it("does not guess from 'instead of Y' when Y is not the pending label", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    await processTurn(state, "I meant supports instead of the survey", questionLLM("ignored"), defaultConfig, "chat", relMap);

    expect(correctedLabel(state)).not.toBe("supports");
    expect(correctedLabel(state)).toBe("I meant supports instead of the survey");
  });

  it("re-prompts on a hedged reply instead of extracting a fragment as the label", async () => {
    const state = createState();
    state.pendingMapCommand = pendingRelationship();

    const out = await processTurn(
      state,
      "I'm not sure it should be anything",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      relMap,
    );

    // Must not lift "anything" out of an uncertain turn; the pending label stays
    // as-is and the coach re-prompts for the wording.
    expect(correctedLabel(state)).toBe("causes");
    expect(out.text).toContain("relationship pending");
  });
});

describe("bug pass: settle re-ask backstop", () => {
  it("steers away from re-settling a concept the user just answered", async () => {
    const state = createState();
    state.lastCoachQuestion = {
      text: "what makes giving back to society matter here?",
      stance: "deepen",
    };
    const reask = "which part of what makes giving back to society matter feels easiest to point at?";
    // The real model tags these settle re-asks with questionStance "settle" (the
    // "settle" chip in the UI); the backstop only fires on an explicit tag.
    const settleReaskLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: reask,
      questionStance: "settle",
    });

    const out = await processTurn(
      state,
      "giving back to society matters because it helps the people I met at the roundabout",
      settleReaskLLM,
      defaultConfig,
      "chat",
      { thoughtUnits: [], connections: [] },
    );

    // The coach must not re-ask the same settled concept back at the user.
    expect(out.text).not.toBe(reask);
    expect(out.mode).toBe("question");
  });
});

describe("bug pass: command precedence over pending label capture", () => {
  it("runs a fresh exact-text card command instead of storing it as a connection label", async () => {
    const state = createState();
    state.pendingMapCommand = {
      kind: "connection_label",
      command: { kind: "connect_cards", source: { id: "tu_1" }, target: { id: "tu_2" } },
      prompt: "What should the label be between #1 and #2?",
      debug: "connection_label_pending",
    };
    const map = { thoughtUnits: [mapUnit("tu_1", "A"), mapUnit("tu_2", "B")], connections: [] };

    const out = await processTurn(
      state,
      "Actually create a card with exactly this text: writer decides final wording",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    const cmds = out.mapCommands ?? [];
    // Command precedence: the create command runs; the pending connection is NOT
    // created with the whole sentence as its label.
    expect(cmds.some((c) => c.kind === "create_card")).toBe(true);
    expect(cmds.some((c) => c.kind === "connect_cards")).toBe(false);
    expect(state.pendingMapCommand?.kind).not.toBe("connection_label");
  });

  it("cancels a pending connection label even when the cancel text names card refs", async () => {
    const state = createState();
    state.pendingMapCommand = {
      kind: "connection_label",
      command: { kind: "connect_cards", source: { id: "tu_1" }, target: { id: "tu_2" } },
      prompt: "What should the label be between #1 and #2?",
      debug: "connection_label_pending",
    };
    const map = { thoughtUnits: [mapUnit("tu_1", "A"), mapUnit("tu_2", "B")], connections: [] };

    const out = await processTurn(
      state,
      "Don't connect #1 to #2",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.[0]?.reason).toBe("connection_label_cancelled");
    expect(state.pendingMapCommand).toBeUndefined();
  });

  it.each([
    [
      "reference confirmation",
      (): PendingMapCommand => ({
        kind: "reference_confirmation",
        command: { kind: "connect_cards", source: { id: "tu_1" }, target: { id: "tu_2" } },
        prompt: "Did you mean that one?",
        debug: "near_match_pending",
        correctionSlots: ["source"],
      }),
    ],
    [
      "relationship confirmation",
      (): PendingMapCommand => ({
        kind: "relationship_confirmation",
        labelText: "supports",
        command: {
          kind: "connect_cards",
          source: { id: "tu_1" },
          target: { id: "tu_2" },
          labelText: "supports",
          labelSourceUtteranceIds: ["u_label"],
        },
        prompt: "It sounds like you want the relationship wording to be 'supports'. Is that right?",
        debug: "relationship_confirmation_pending",
      }),
    ],
    [
      "duplicate connection confirmation",
      (): PendingMapCommand => ({
        kind: "duplicate_connection_confirmation",
        command: { kind: "connect_cards", source: { id: "tu_1" }, target: { id: "tu_2" } },
        prompt: "There is already a connection. Add another?",
        debug: "duplicate_connection_pending",
      }),
    ],
  ])("runs a fresh exact-text card command instead of staying wedged in %s", async (_name, makePending) => {
    const state = createState();
    state.pendingMapCommand = makePending();
    const map = { thoughtUnits: [mapUnit("tu_1", "A"), mapUnit("tu_2", "B")], connections: [] };

    const out = await processTurn(
      state,
      "Actually create a card with exactly this text: writer decides final wording",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "writer decides final wording",
        sourceUtteranceIds: ["u_1"],
      },
    ]);
    expect(state.pendingMapCommand).toBeUndefined();
  });

  it("runs a fresh exact-text card command instead of capturing it as pending child wording", async () => {
    const state = createState();
    state.pendingChildPlacement = {
      parentId: "tu_1",
      parentText: "A",
      remaining: 1,
    };
    const map = { thoughtUnits: [mapUnit("tu_1", "A")], connections: [] };

    const out = await processTurn(
      state,
      "Actually create a card with exactly this text: writer decides final wording",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "create_card",
        text: "writer decides final wording",
        sourceUtteranceIds: ["u_1"],
      },
    ]);
    expect(state.pendingChildPlacement).toBeUndefined();
  });
});

describe("bug pass: user-forced mirror bypasses pacing cooldown", () => {
  const cfg = { ...defaultConfig, pacing: { ...defaultConfig.pacing, minQuestionTurnsBetweenMirrors: 3 } };

  it("does not suppress a forced mirror as cooldown, but still does for an unforced one", async () => {
    const forced = createState();
    await processTurn(forced, "human control decides the wording", questionLLM("Q"), cfg);
    forced.turnsSinceLastMirror = 0;
    const forcedOut = await processTurn(
      forced,
      "",
      groundedMirrorLLM("human control decides the wording", forced.bank.getAll()[0].id),
      cfg,
      "chat",
      { thoughtUnits: [], connections: [] },
      { ingestUser: false, overrideMode: "mirror" },
    );
    expect(forcedOut.suppressionReason).not.toBe("cooldown");

    const paced = createState();
    await processTurn(paced, "human control decides the wording", questionLLM("Q"), cfg);
    paced.turnsSinceLastMirror = 0;
    const pacedOut = await processTurn(
      paced,
      "human control decides the wording",
      groundedMirrorLLM("human control decides the wording", paced.bank.getAll()[0].id),
      cfg,
    );
    expect(pacedOut.suppressionReason).toBe("cooldown");
  });
});

describe("bug pass: exact-text command provenance", () => {
  it("does not mark unrelated same-turn wording as command-only", async () => {
    const state = createState();
    const out = await processTurn(
      state,
      "Fairness should stay separate. Create a card with exactly this text: AI is risky. It removes agency.",
      questionLLM("ignored"),
      defaultConfig,
    );

    const create = out.mapCommands?.find((command) => command.kind === "create_card");
    expect(create?.kind).toBe("create_card");
    expect(create?.kind === "create_card" ? create.text : "").toBe("AI is risky. It removes agency.");

    const bank = state.bank.getAll();
    expect(bank.map((unit) => unit.text)).toEqual([
      "Fairness should stay separate.",
      "Create a card with exactly this text: AI is risky.",
      "It removes agency.",
    ]);
    expect(bank[0].commandOnly).toBeFalsy();
    expect(bank[1].commandOnly).toBe(true);
    expect(bank[2].commandOnly).toBe(true);
    expect(create?.kind === "create_card" ? create.sourceUtteranceIds : []).toEqual([bank[1].id, bank[2].id]);
  });
});

// ---------------------------------------------------------------------------
// Hardening pass: clarify-span attribution, clarify-pin lifecycle, capture-loop
// memory, and the stale-uncertainty settle drift
// ---------------------------------------------------------------------------

describe("hardening: model-authored clarify phrases are never attributed to the user", () => {
  /** Mirror whose weakest failing span carries a phrase the user never said. */
  function inventedSpanMirrorLLM(utteranceId: string) {
    return (_ctx: LLMContext): LLMTurn => {
      const phrase = "the fabricated lattice framing";
      const claim: MirrorClaim = {
        id: "c1",
        text: phrase,
        candidateId: "cand1",
        target: "idea",
        sourceSpans: [{ claimText: phrase, utteranceIds: [utteranceId], userPhrase: phrase }],
      };
      return {
        mode: "mirror",
        text: "unshown",
        mirror: { claims: [claim] },
        candidateUpserts: [
          { id: "cand1", target: "idea", gist: "running fast", addEvidenceIds: [utteranceId] },
        ],
      };
    };
  }

  it("does not quote an ungrounded weakest span back as 'when you said ...'", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "sure", inventedSpanMirrorLLM(uid), cfg);

    expect(out.mode).toBe("clarify");
    expect(out.suppressionReason).toBe("validation_failed");
    expect(out.text).not.toContain("fabricated lattice");
    expect(out.text).not.toContain("when you said");
    expect(state.clarifyTarget).toBeUndefined();
    const snapshotJson = JSON.stringify(out.understanding ?? {});
    expect(snapshotJson).not.toContain("fabricated lattice");
  });

  it("still quotes the weakest span when it really is the user's wording", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    const out = await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);

    expect(out.text).toContain('when you said "running fast"');
    expect(state.clarifyTarget?.userPhrase).toBe("running fast");
  });

  it("drops an invented clarifySpan from a clarify-mode turn instead of pinning it", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const out = await processTurn(state, "sure", (_ctx: LLMContext): LLMTurn => ({
      mode: "clarify",
      text: "Which part is doing the most work?",
      clarifySpan: {
        claimText: "x",
        utteranceIds: [state.bank.getAll()[0].id],
        userPhrase: "the fabricated lattice framing",
      },
    }), cfg);

    expect(out.mode).toBe("clarify");
    expect(state.clarifyTarget).toBeUndefined();
    const snapshotJson = JSON.stringify(out.understanding ?? {});
    expect(snapshotJson).not.toContain("fabricated lattice");
  });

  it("does not treat a mid-word fragment as user-attributable clarify wording", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "let's start fresh", questionLLM("Q"), cfg);
    const out = await processTurn(state, "sure", (_ctx: LLMContext): LLMTurn => ({
      mode: "clarify",
      text: "Which part matters?",
      clarifySpan: {
        claimText: "art",
        utteranceIds: [state.bank.getAll()[0].id],
        userPhrase: "art",
      },
    }), cfg);

    expect(out.mode).toBe("clarify");
    expect(state.clarifyTarget).toBeUndefined();
  });

  it("keeps a clarifySpan whose phrase is verbatim user wording", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    await processTurn(state, "sure", (_ctx: LLMContext): LLMTurn => ({
      mode: "clarify",
      text: "What does running fast mean here?",
      clarifySpan: {
        claimText: "running fast",
        utteranceIds: [state.bank.getAll()[0].id],
        userPhrase: "running fast",
      },
    }), cfg);

    expect(state.clarifyTarget?.userPhrase).toBe("running fast");
  });
});

describe("hardening: clarify pin lifecycle", () => {
  it("clears the clarify pin when the model moves on to a plain question", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);
    expect(state.clarifyTarget).toBeDefined();

    await processTurn(state, "a follow-up thought", questionLLM("Fresh question?"), cfg);
    expect(state.clarifyTarget).toBeUndefined();
    expect(state.activeElicitation).toBeUndefined();
  });

  it("keeps the pin across consecutive clarify turns", async () => {
    const state = createState();
    const cfg = noReadinessCfg();
    await processTurn(state, "running fast", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;
    await processTurn(state, "sure", driftingMirrorLLM(uid), cfg);

    await processTurn(state, "a follow-up thought", (_ctx: LLMContext): LLMTurn => ({
      mode: "clarify",
      text: "Say more about that part?",
    }), cfg);
    expect(state.clarifyTarget?.userPhrase).toBe("running fast");
  });
});

describe("hardening: capture-loop memory dies with its elicitation", () => {
  const carryForwardQuestion = "What exact wording do you want to carry forward as the next card?";

  async function armCaptureLoop(state: ReturnType<typeof createState>): Promise<void> {
    await processTurn(state, "let me think about oversight", questionLLM(carryForwardQuestion), defaultConfig);
    expect(state.activeElicitation?.kind).toBe("sparse_map_next_card");
    await processTurn(state, "human oversight matters", questionLLM(carryForwardQuestion), defaultConfig);
    expect(state.captureLoop?.repeatCount).toBe(1);
  }

  it("clears captureLoop when the elicitation ends on a plain question", async () => {
    const state = createState();
    await armCaptureLoop(state);
    await processTurn(state, "actually something new", questionLLM("Totally fresh question?"), defaultConfig);
    expect(state.activeElicitation).toBeUndefined();
    expect(state.captureLoop).toBeUndefined();
  });

  it("clears captureLoop on a user-forced mode override", async () => {
    const state = createState();
    await armCaptureLoop(state);
    await processTurn(
      state,
      "",
      questionLLM("Fresh question?"),
      defaultConfig,
      "chat",
      { thoughtUnits: [], connections: [] },
      { ingestUser: false, overrideMode: "pivot" },
    );
    expect(state.captureLoop).toBeUndefined();
    expect(state.pendingCardWording).toBeUndefined();
  });
});

describe("hardening: LLM cannot author structure between existing cards", () => {
  const twoCardMap = (): LLMMapContext => ({
    thoughtUnits: [mapUnit("tu_1", "human control"), mapUnit("tu_2", "authorship")],
    connections: [],
  });

  it("blocks an LLM nest between existing cards the user never asked to nest", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      mapCommands: [
        { kind: "nest_card", childText: "human control", parentText: "authorship" },
      ],
    });

    const out = await processTurn(state, "I keep thinking about oversight", llm, defaultConfig, "chat", twoCardMap());

    expect(out.mapCommands).toBeUndefined();
    expect(
      out.commandDebug?.some((note) =>
        note.reason === "ungrounded_existing_endpoint" || note.reason === "blocked_interpretation",
      ),
    ).toBe(true);
  });

  it("blocks a declarative 'belongs under' from executing as a nest command", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      mapCommands: [
        { kind: "nest_card", childText: "human control", parentText: "authorship" },
      ],
    });

    const out = await processTurn(
      state,
      "human control belongs under authorship in my head",
      llm,
      defaultConfig,
      "chat",
      twoCardMap(),
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "blocked_interpretation")).toBe(true);
  });

  it("still executes an instruction-shaped nest between existing named cards", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      mapCommands: [
        { kind: "nest_card", childText: "human control", parentText: "authorship" },
      ],
    });

    const out = await processTurn(
      state,
      "put human control under authorship",
      llm,
      defaultConfig,
      "chat",
      twoCardMap(),
    );

    expect(out.mapCommands).toEqual([
      { kind: "nest_card", child: { id: "tu_1" }, parentId: "tu_2" },
    ]);
  });

  it("blocks a declarative 'these connect' from executing as a connection command", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      mapCommands: [
        { kind: "connect_cards", sourceText: "human control", targetText: "authorship" },
      ],
    });

    const out = await processTurn(
      state,
      "human control and authorship connect deeply for me",
      llm,
      defaultConfig,
      "chat",
      twoCardMap(),
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "blocked_interpretation")).toBe(true);
  });

  it("blocks a create_card whose phrase is only a mid-word fragment of the turn", async () => {
    const state = createState();
    const llm = (ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      mapCommands: [
        {
          kind: "create_card",
          text: "art",
          sourceSpan: { userPhrase: "art", utteranceIds: [ctx.bank[ctx.bank.length - 1]!.id] },
        },
      ],
    });

    const out = await processTurn(state, "we should start fresh on this part of it", llm);

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "not_current_turn_span")).toBe(true);
  });
});

describe("hardening: pending commands whose cards were deleted mid-flow", () => {
  it("drops a stale reference confirmation on 'yes' instead of faking Done", async () => {
    const state = createState();
    // Only tu_451 still exists — tu_448 was deleted while the confirm waited.
    const map: LLMMapContext = {
      thoughtUnits: [mapUnit("tu_451", "main claim")],
      connections: [],
    };
    state.pendingMapCommand = {
      kind: "reference_confirmation",
      command: { kind: "connect_cards", source: { id: "tu_448" }, target: { id: "tu_451" } },
      prompt: "Did you mean that one?",
      debug: "near_match_pending",
      correctionSlots: ["source"],
    };

    const out = await processTurn(state, "yes", questionLLM("ignored"), defaultConfig, "chat", map);

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("no longer on the map");
    expect(out.commandDebug?.[0]?.reason).toBe("pending_command_stale_reference");
    expect(state.pendingMapCommand).toBeUndefined();
  });

  it("drops a stale child placement instead of nesting under a deleted parent", async () => {
    const state = createState();
    state.pendingChildPlacement = {
      parentId: "tu_577",
      parentText: "Mechanism 1",
      remaining: 1,
    };

    const out = await processTurn(
      state,
      "No silent commits without review",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      { thoughtUnits: [], connections: [] },
    );

    expect(out.mapCommands).toBeUndefined();
    expect(out.text).toContain("no longer on the map");
    expect(state.pendingChildPlacement).toBeUndefined();
  });
});

describe("hardening: stale-uncertainty settle drift (Goal 5 backstop)", () => {
  it("steers a settle re-ask that anchors on a stale 'not sure' after a substantive answer", async () => {
    const state = createState();
    await processTurn(state, "control matters to me", questionLLM("What does control mean to you?"), defaultConfig);
    expect(state.lastCoachQuestion?.text).toBe("What does control mean to you?");

    const driftedSettleLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Earlier you said you were not sure - which part still feels shaky to you?",
      questionStance: "settle",
    });
    const out = await processTurn(
      state,
      "control means people can veto decisions they distrust",
      driftedSettleLLM,
      defaultConfig,
    );

    expect(out.text).not.toContain("Earlier you said");
    expect(out.text).toContain("Let's ease off that one");
    expect(out.questionStance).toBe("settle");
  });

  it("leaves a genuinely new settle question alone", async () => {
    const state = createState();
    await processTurn(state, "control matters to me", questionLLM("What does control mean to you?"), defaultConfig);

    const freshSettleLLM = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What is one small piece of the veto idea you could pin down first?",
      questionStance: "settle",
    });
    const out = await processTurn(
      state,
      "control means people can veto decisions they distrust",
      freshSettleLLM,
      defaultConfig,
    );

    expect(out.text).toBe("What is one small piece of the veto idea you could pin down first?");
  });
});

describe("parked/authorship hardening follow-ups", () => {
  it("accepts an exact current-turn edit_card command for a named card", async () => {
    const state = createState();
    const map: LLMMapContext = {
      thoughtUnits: [mapUnit("tu_10", "human control")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "reword #10 to human authorship stays in charge",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands).toEqual([
      {
        kind: "edit_card",
        id: "tu_10",
        text: "human authorship stays in charge",
        sourceUtteranceIds: [expect.any(String)],
      },
    ]);
  });

  it("accepts colon-style exact edit wording", async () => {
    const state = createState();
    const map: LLMMapContext = {
      thoughtUnits: [mapUnit("tu_10", "human control")],
      connections: [],
    };

    const out = await processTurn(
      state,
      "make #10 say: human authorship stays in charge",
      questionLLM("ignored"),
      defaultConfig,
      "chat",
      map,
    );

    expect(out.mapCommands?.[0]).toMatchObject({
      kind: "edit_card",
      id: "tu_10",
      text: "human authorship stays in charge",
    });
  });

  it("blocks LLM edit_card replacement wording that was not in the current turn", async () => {
    const state = createState();
    const map: LLMMapContext = {
      thoughtUnits: [mapUnit("tu_10", "human control")],
      connections: [],
    };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What should change?",
      mapCommands: [
        {
          kind: "edit_card",
          cardText: "#10",
          newText: "stale replacement from memory",
          sourceSpan: { userPhrase: "stale replacement from memory", utteranceIds: [] },
        },
      ],
    });

    const out = await processTurn(state, "look at #10", llm, defaultConfig, "chat", map);

    expect(out.mapCommands).toBeUndefined();
    expect(out.commandDebug?.some((note) => note.reason === "not_current_turn_span")).toBe(true);
  });

  it("treats typed mirror commands like the Under the Hood mirror override", async () => {
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 99 });
    const state = createState();
    await processTurn(state, "human control decides the wording", questionLLM("Q"), cfg);
    const uid = state.bank.getAll()[0].id;

    const out = await processTurn(
      state,
      "mirror it",
      groundedMirrorLLM("human control decides the wording", uid),
      cfg,
    );

    expect(out.mode).toBe("mirror");
    expect(out.text).toBe(MIRROR_PREAMBLE);
    expect(state.bank.getAll().find((unit) => unit.text === "mirror it")?.commandOnly).toBe(true);
  });

  it("off-ramps content-authoring requests without harvesting them", async () => {
    const state = createState();
    state.activeElicitation = { kind: "carry_forward" };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "ignored",
      candidateUpserts: [{ id: "bad", target: "idea", gist: "summarize", addEvidenceIds: [] }],
    });

    const out = await processTurn(state, "can you summarize my draft for me", llm);

    expect(out.text).toContain("I can't write or summarize the draft for you");
    expect(out.mapCommands).toBeUndefined();
    expect(state.candidates.getAll()).toHaveLength(0);
    expect(state.activeElicitation).toBeUndefined();
    expect(state.bank.getAll()[0].commandOnly).toBe(true);
  });

  it("recognizes curly-apostrophe meta repair turns without harvesting them", async () => {
    const state = createState();
    const out = await processTurn(state, "that\u2019s wrong", questionLLM("ignored"));

    expect(out.text).toContain("Let's slow it down");
    expect(out.commandDebug?.[0]?.reason).toBe("meta_repair_off_ramp");
    expect(state.bank.getAll()[0].commandOnly).toBe(true);
  });

  it("answers card-capability questions honestly instead of looping the coach", async () => {
    // Both transcript phrasings that previously fell through to the coach loop.
    for (const question of ["can you reword a card", "are you capable of rewording a card?"]) {
      const state = createState();
      const out = await processTurn(state, question, questionLLM("ignored"));

      expect(out.commandDebug?.[0]?.reason).toBe("capability_off_ramp");
      expect(out.text).toContain("reword #12");
      expect(out.mapCommands).toBeUndefined();
      expect(state.bank.getAll()[0].commandOnly).toBe(true);
    }
  });

  it("answers unsupported capability questions from the manifest without harvesting them", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => {
      throw new Error("capability off-ramp should not call the LLM");
    };

    const out = await processTurn(state, "can you make cards blue", llm);

    expect(out.commandDebug?.[0]?.reason).toBe("capability_off_ramp");
    expect(out.text).toContain("change card colors, styling, layout, or other appearance settings");
    expect(out.mapCommands).toBeUndefined();
    expect(state.candidates.getAll()).toHaveLength(0);
    expect(state.bank.getAll()[0].commandOnly).toBe(true);

    for (const question of ["can you change the layout", "can you export this map"]) {
      const nextState = createState();
      const nextOut = await processTurn(nextState, question, llm);
      expect(nextOut.commandDebug?.[0]?.reason).toBe("capability_off_ramp");
      expect(nextState.bank.getAll()[0].commandOnly).toBe(true);
    }
  });

  it("does not hijack writing subject matter (style/color/layout) as a capability ask", async () => {
    // These are about the user's WRITING, not an app feature — they must reach the
    // coach, not the capability off-ramp, and their content stays harvestable.
    for (const content of [
      "can you tell me if my style is clear and matches my argument",
      "color theory matters a lot in the essay I am writing",
      "the layout of my argument feels off to me",
      "can you help me make my writing style clearer",
      "what is the central theme of my essay about ownership",
    ]) {
      const state = createState();
      const out = await processTurn(state, content, questionLLM("Say more?"));
      expect(out.commandDebug?.[0]?.reason).not.toBe("capability_off_ramp");
      expect(out.suppressionReason).not.toBe("meta_aside");
      expect(state.bank.getAll().every((u) => !u.commandOnly && !u.nonHarvestable)).toBe(true);
    }
  });

  it("renders deterministic capability answers from config rather than hardcoded text", async () => {
    const state = createState();
    const cfg: MindmapConfig = {
      ...defaultConfig,
      capabilities: {
        canDo: ["custom supported action"],
        cantDo: ["custom unsupported action"],
      },
    };

    const out = await processTurn(state, "what can you do", questionLLM("ignored"), cfg);

    expect(out.commandDebug?.[0]?.reason).toBe("capability_off_ramp");
    expect(out.text).toContain("custom supported action");
    expect(out.text).toContain("custom unsupported action");
    expect(out.text).not.toContain("reword #12");
  });

  it("fences a pure-meta aside: shows the model's words, harvests nothing, drops smuggled structure", async () => {
    const state = createState();
    const map = { thoughtUnits: [mapUnit("tu_10", "authorial ownership")], connections: [] };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "No worries — take your time.",
      metaIntent: "social",
      // Smuggled structure on an aside turn — every bit must be dropped.
      mapCommands: [
        { kind: "create_card", text: "sneaky card", sourceSpan: { userPhrase: "sneaky card", utteranceIds: [] } },
      ],
      candidateUpserts: [{ id: "meta_bad", target: "idea", gist: "sneaky gist", addEvidenceIds: ["u_1"] }],
    });

    const out = await processTurn(state, "haha ok", llm, defaultConfig, "chat", map);

    expect(out.text).toBe("No worries — take your time.");
    expect(out.suppressionReason).toBe("meta_aside");
    expect(out.mapCommands).toBeUndefined();
    expect(state.candidates.getAll()).toHaveLength(0);
    // Banked for provenance, but marked non-harvestable (not a command).
    const utterance = state.bank.getAll()[0];
    expect(utterance.nonHarvestable).toBe(true);
    expect(utterance.commandOnly).toBeUndefined();
  });

  it("preserves pending card wording when a pure-meta aside interrupts capture", async () => {
    const state = createState();
    state.activeElicitation = { kind: "carry_forward" };
    state.pendingCardWording = {
      text: "writer owns the final wording",
      normalizedText: "writer owns the final wording",
      utteranceIds: ["u_prev"],
      source: "carry_forward",
      attemptCount: 1,
    };
    state.captureLoop = { lastAnswerNorm: "writer owns the final wording", repeatCount: 1 };
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "We can pause there.",
      metaIntent: "emotional",
    });

    const out = await processTurn(state, "ugh", llm);

    expect(out.suppressionReason).toBe("meta_aside");
    expect(state.pendingCardWording?.text).toBe("writer owns the final wording");
    expect(state.captureLoop?.lastAnswerNorm).toBe("writer owns the final wording");
    expect(state.activeElicitation).toEqual({ kind: "carry_forward" });
  });

  it("does not offer non-harvestable aside wording as a grounded focus option", async () => {
    const state = createState();
    await processTurn(state, "ugh", (_ctx): LLMTurn => ({
      mode: "question",
      text: "We can pause there.",
      metaIntent: "emotional",
    }));

    const out = await processTurn(
      state,
      "what should I do next",
      questionLLM("Which part feels easiest to start with?"),
    );

    expect(out.text).not.toContain("ugh");
  });

  it("does NOT honor metaIntent on a mixed turn that carries real writing content", async () => {
    const state = createState();
    const llm = (_ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "What feels most alive there?",
      metaIntent: "emotional",
      affect: "frustrated",
    });

    const out = await processTurn(
      state,
      "honestly I'm frustrated, but the real point is authorship requires more control from the writer",
      llm,
    );

    // The aside is not honored — the content is coached and stays harvestable.
    expect(out.suppressionReason).not.toBe("meta_aside");
    expect(state.bank.getAll().every((u) => !u.nonHarvestable)).toBe(true);
  });

  it("drops the map-ward pressure nudge when the user seems drained (deterministic floor)", async () => {
    const cfg = noReadinessCfg({ minQuestionTurnsBetweenMirrors: 0, minReadyCandidatesToBatch: 2 });
    // Prime two ready candidates so mirror-pressure would normally fire.
    const state = createState();
    const primeLLM = (ctx: LLMContext): LLMTurn => ({
      mode: "question",
      text: "Q",
      questionStance: "deepen",
      candidateUpserts: ctx.bank.slice(-1).map((u, i) => ({
        id: `ready_${state.candidates.getAll().length + i + 1}`,
        target: "idea" as const,
        gist: u.text,
        addEvidenceIds: [u.id],
      })),
    });
    await processTurn(state, "control means the writer decides everything", primeLLM, cfg);
    await processTurn(state, "ownership means the writer keeps authorship", primeLLM, cfg);

    // A drained turn must not get the "close enough to reflect back?" push.
    const out = await processTurn(state, "honestly I'm exhausted right now", questionLLM("plain"), cfg);
    expect(out.suppressionReason).not.toBe("mirror_pressure_bridge");
  });

  it("filters dismissed candidate upserts until the user freshly re-articulates them", async () => {
    const state = createState();
    await processTurn(state, "old idea", questionLLM("Q"));
    const oldId = state.bank.getAll()[0].id;
    state.dismissedCandidateIds = ["cand1"];

    await processTurn(
      state,
      "unrelated followup",
      (_ctx: LLMContext): LLMTurn => ({
        mode: "question",
        text: "Q2",
        candidateUpserts: [{ id: "cand1", target: "idea", gist: "old idea", addEvidenceIds: [oldId] }],
      }),
    );

    expect(state.candidates.get("cand1")).toBeUndefined();
    expect(state.dismissedCandidateIds).toEqual(["cand1"]);

    await processTurn(
      state,
      "old idea returns",
      (ctx: LLMContext): LLMTurn => ({
        mode: "question",
        text: "Q3",
        candidateUpserts: [
          {
            id: "cand1",
            target: "idea",
            gist: "old idea",
            addEvidenceIds: [ctx.bank[ctx.bank.length - 1].id],
          },
        ],
      }),
    );

    expect(state.candidates.get("cand1")).toBeDefined();
    expect(state.dismissedCandidateIds).toEqual([]);
  });
});
