/**
 * Property/fuzz harness for processTurn.
 *
 * Drives the full state machine through hundreds of randomized turn sequences —
 * an ADVERSARIAL mock LLM (invented mirror text, cross-utterance relationship
 * claims, fabricated map commands, fake evidence ids, model-prose clarify spans)
 * against varied user inputs (substantive / stuck / affirmative / negative /
 * cancel / commands / questions / dumps / overrides) and varied map states —
 * and asserts the enforcement invariants EVERY turn:
 *
 *   I1  processTurn never throws (failures report the seed + input trace).
 *   I2  The controller always lands in a valid mode with non-empty text.
 *   I3  A mirror never ships ungrounded: validatedMirror is set, re-passes the
 *       validator against the live bank, and the shown text is the fixed
 *       preamble (never model prose).
 *   I4  The coach never authors structure: every NEW text a command mints
 *       (card text, nested child, connect endpoints, labels) is an exact
 *       substring of something the user actually typed, and after applying
 *       commands the map contains ONLY user vocabulary (marker tokens the
 *       adversarial LLM injects must never appear).
 *   I5  The Under-the-Hood snapshot is read-only: it never carries a
 *       map-mutation command shape and never leaks the adversarial LLM's
 *       marker prose as if it were user wording.
 *   I6  No transient LoopState field wedges: any field continuously set for
 *       WEDGE_PROBE_AT turns must clear under the canonical escape sequence
 *       (cancel -> cancel -> move on -> substantive pivot).
 *
 * Reproducing a failure: every assertion message includes the run seed and the
 * recent input trace. Re-run with that seed via the `fuzzRun` helper.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { defaultConfig, withQuestionIntentBias, type MindmapConfig } from "./config";
import {
  createState,
  MIRROR_PREAMBLE,
  processTurn,
  type LoopState,
  type ProcessTurnOptions,
  type TurnOutput,
} from "./controller";
import type { LLMContext, LLMTurn, MapCommand, MockLLM } from "./llm-contract";
import { applyAcceptedMapCommands } from "./map-commands";
import { ThoughtUnitStore } from "./map-store";
import { contentTokens, normalize, stem } from "./normalize";
import { cardRef, resetIdCounter } from "./store";
import { validateMirror } from "./validator";
import type { MirrorClaim, SourceUtterance } from "./types";

beforeEach(() => {
  resetIdCounter();
});

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function chance(rng: () => number, p: number): boolean {
  return rng() < p;
}

// Marker tokens the adversarial LLM injects. They never occur in user inputs,
// so their appearance anywhere user-facing is a smoking gun.
const INVENTED_MARKER = "zyxxq";
const MODEL_PROSE_MARKER = "modelprose";

// ---------------------------------------------------------------------------
// User-input generation
// ---------------------------------------------------------------------------

const TOPIC_PHRASES = [
  "human oversight",
  "model transparency",
  "audit trails",
  "user trust",
  "shared control",
  "data provenance",
  "slow feedback",
  "team judgment",
  "clear incentives",
  "honest defaults",
] as const;

const TOPIC_LINKS = [
  "builds",
  "erodes",
  "shapes",
  "protects",
  "requires",
  "depends on",
  "leads to",
  "is part of",
] as const;

const TOPIC_TAILS = [
  "over time",
  "in practice",
  "for new users",
  "under pressure",
  "at scale",
  "when nobody is watching",
] as const;

function substantiveSentence(rng: () => number): string {
  return `${pick(rng, TOPIC_PHRASES)} ${pick(rng, TOPIC_LINKS)} ${pick(rng, TOPIC_PHRASES)} ${pick(rng, TOPIC_TAILS)}`;
}

interface FuzzInput {
  kind: string;
  text: string;
  options?: ProcessTurnOptions;
}

interface TurnLogEntry {
  turn: number;
  input: string;
  kind: string;
  outMode: string;
  outText: string;
}

interface FuzzWorld {
  state: LoopState;
  store: ThoughtUnitStore;
  config: MindmapConfig;
  rng: () => number;
  seed: number;
  /** Every string the user has authored (chat inputs, seeded card texts, draft). */
  userCorpus: string[];
  corpusStems: Set<string>;
  log: TurnLogEntry[];
  /** While true the mock LLM answers with a plain question (escape probe). */
  forcePlain: boolean;
  requireConnectionLabel: boolean;
}

function addToCorpus(world: FuzzWorld, text: string): void {
  world.userCorpus.push(text);
  for (const token of contentTokens(text)) world.corpusStems.add(stem(token));
}

function mapRefs(world: FuzzWorld): string[] {
  return world.store
    .getAll()
    .filter((unit) => unit.role !== "connection_label" && unit.text.trim())
    .map((unit) => cardRef(unit.id));
}

function mapCardTexts(world: FuzzWorld): string[] {
  return world.store
    .getAll()
    .filter((unit) => unit.role !== "connection_label" && unit.text.trim())
    .map((unit) => unit.text);
}

function nextUserInput(world: FuzzWorld): FuzzInput {
  const { rng } = world;
  const refs = mapRefs(world);
  const cardTexts = mapCardTexts(world);
  const roll = rng();

  if (roll < 0.30) {
    return { kind: "substantive", text: substantiveSentence(rng) };
  }
  if (roll < 0.37) {
    return { kind: "stuck", text: pick(rng, ["I'm not sure", "I don't know what you mean", "no idea honestly"]) };
  }
  if (roll < 0.44) {
    return { kind: "affirmative", text: pick(rng, ["yes", "yeah that one", "yep exactly"]) };
  }
  if (roll < 0.49) {
    return { kind: "negative", text: pick(rng, ["no", "nope"]) };
  }
  if (roll < 0.53) {
    return { kind: "cancel", text: pick(rng, ["never mind", "cancel"]) };
  }
  if (roll < 0.56) {
    return { kind: "move_on", text: "let's move on" };
  }
  if (roll < 0.59) {
    return { kind: "label_decline", text: pick(rng, ["no label", "skip"]) };
  }
  if (roll < 0.63) {
    return {
      kind: "help_question",
      text: pick(rng, [
        "Can you give me an example?",
        "any recommendations?",
        "where could we go from here?",
      ]),
    };
  }
  if (roll < 0.69) {
    const phrase = pick(rng, TOPIC_PHRASES);
    return {
      kind: "create_command",
      text: pick(rng, [
        `Put ${phrase} on the map`,
        `make a card called ${phrase}`,
        `Create a card with exactly this text: ${phrase} matters here`,
      ]),
    };
  }
  if (roll < 0.74 && refs.length >= 2) {
    const a = pick(rng, refs);
    let b = pick(rng, refs);
    if (a === b) b = refs.find((r) => r !== a) ?? b;
    return {
      kind: "ref_command",
      text: pick(rng, [
        `Connect ${a} to ${b}`,
        `put ${a} under ${b}`,
        `reword ${a} to ${pick(rng, TOPIC_PHRASES)} ${pick(rng, TOPIC_TAILS)}`,
      ]),
    };
  }
  if (roll < 0.77 && cardTexts.length >= 2) {
    const a = pick(rng, cardTexts);
    let b = pick(rng, cardTexts);
    if (a === b) b = cardTexts.find((t) => t !== a) ?? b;
    return { kind: "text_connect", text: `connect ${a} to ${b}` };
  }
  if (roll < 0.80) {
    const s1 = substantiveSentence(rng);
    const s2 = substantiveSentence(rng);
    return {
      kind: "exact_text_multi",
      text: `Create a card with exactly this text: ${s1}. ${s2}.`,
    };
  }
  if (roll < 0.83 && refs.length >= 1) {
    return { kind: "coverage", text: `Does ${pick(rng, refs)} cover the main point?` };
  }
  if (roll < 0.86) {
    return { kind: "pivot", text: "let's talk about the ethics side instead" };
  }
  if (roll < 0.91) {
    const sentences = Array.from({ length: 5 }, () => `${substantiveSentence(rng)}.`);
    return { kind: "dump", text: sentences.join(" ") };
  }
  if (roll < 0.95) {
    return {
      kind: "override",
      text: "",
      options: {
        ingestUser: false,
        overrideMode: pick(rng, ["mirror", "deepen", "organize", "pivot"] as const),
      },
    };
  }
  return { kind: "question_shaped", text: `Should this be a card: ${pick(rng, TOPIC_PHRASES)}?` };
}

// ---------------------------------------------------------------------------
// Adversarial mock LLM
// ---------------------------------------------------------------------------

const PLAIN_QUESTIONS = [
  "What feels most alive to you right now?",
  "Where do you want to take this next?",
  "What is one detail you keep coming back to?",
] as const;

function latestEligible(ctx: LLMContext, count: number): SourceUtterance[] {
  return ctx.bank.slice(-count);
}

function candidateIdFor(utteranceId: string): string {
  return `cand_${utteranceId}`;
}

function groundedClaim(utterance: SourceUtterance, reorder: boolean): MirrorClaim {
  // Reordering user words is allowed by the validator (stems, not sequence) —
  // exercise it so the harness's own authorship check stays honest.
  const words = utterance.text.split(/\s+/);
  const text = reorder ? [...words].reverse().join(" ") : utterance.text;
  return {
    id: `claim_${utterance.id}`,
    text,
    candidateId: candidateIdFor(utterance.id),
    target: "idea",
    sourceSpans: [
      { claimText: text, utteranceIds: [utterance.id], userPhrase: utterance.text },
    ],
  };
}

function buildAdversarialLLM(world: FuzzWorld): MockLLM {
  const { rng } = world;
  return (ctx: LLMContext): LLMTurn => {
    if (world.forcePlain) {
      return { mode: "question", text: pick(rng, PLAIN_QUESTIONS), questionStance: "settle" };
    }

    const recent = latestEligible(ctx, 3);
    const roll = rng();

    // --- Question flavors (some deliberately arm transient state) ---
    if (roll < 0.28) {
      const flavor = rng();
      if (flavor < 0.15 && ctx.lastAiText) {
        // Verbatim repeat — must trip the anti-repeat guard, never loop.
        return { mode: "question", text: ctx.lastAiText, questionStance: "deepen" };
      }
      if (flavor < 0.3) {
        const cards = ctx.map.thoughtUnits.filter((u) => u.role !== "connection_label");
        if (cards.length >= 2) {
          const a = cardRef(cards[0]!.id);
          const b = cardRef(cards[1]!.id);
          return {
            mode: "question",
            text: `How would you describe the relationship between ${a} and ${b} in your own words?`,
            questionIntent: "organize",
            questionStance: "organize",
          };
        }
      }
      if (flavor < 0.45) {
        return {
          mode: "question",
          text: "What exact wording do you want to carry forward as the next card?",
          questionStance: "organize",
        };
      }
      if (flavor < 0.55) {
        const parent = ctx.map.thoughtUnits.find((u) => u.role !== "connection_label");
        if (parent) {
          return {
            mode: "question",
            text: `What exact words should go on the 2 smaller cards under ${parent.text}?`,
            questionStance: "narrow",
          };
        }
      }
      return {
        mode: "question",
        text: pick(rng, PLAIN_QUESTIONS),
        questionStance: pick(rng, ["deepen", "narrow", "settle", "organize", "challenge"] as const),
        questionIntent: chance(rng, 0.3) ? "organize" : "deepen",
      };
    }

    // --- Grounded mirror attempts (accumulate candidates so readiness can pass) ---
    if (roll < 0.5) {
      if (recent.length === 0) {
        return { mode: "question", text: pick(rng, PLAIN_QUESTIONS) };
      }
      const focus = pick(rng, recent);
      const existing = ctx.candidates.find((c) => c.id === candidateIdFor(focus.id));
      const evidence = new Set(existing?.evidenceUtteranceIds ?? []);
      evidence.add(focus.id);
      // Cite one more recent utterance to build density across turns.
      const extra = recent.find((u) => u.id !== focus.id);
      if (extra) evidence.add(extra.id);
      const claims = [groundedClaim(focus, chance(rng, 0.25))];
      if (extra && chance(rng, 0.3)) claims.push(groundedClaim(extra, false));
      return {
        mode: "mirror",
        text: `${MODEL_PROSE_MARKER} free preamble that must never be shown`,
        mirror: { claims },
        candidateUpserts: [
          {
            id: candidateIdFor(focus.id),
            target: "idea",
            gist: chance(rng, 0.3) ? `${MODEL_PROSE_MARKER} ${focus.text}` : focus.text,
            addEvidenceIds: [...evidence],
          },
        ],
        carryForwardCandidateIds: chance(rng, 0.3) ? [candidateIdFor(focus.id)] : undefined,
      };
    }

    // --- Ungrounded / adversarial mirrors: must be blocked, route to clarify ---
    if (roll < 0.62) {
      const cited = recent[0]?.id ?? "u_nonexistent";
      const attack = rng();
      if (attack < 0.5) {
        // Pure invention.
        const text = `the ${INVENTED_MARKER} lattice underpins everything`;
        return {
          mode: "mirror",
          text: "invented",
          mirror: {
            claims: [
              {
                id: "bad1",
                text,
                candidateId: candidateIdFor(cited),
                target: "idea",
                sourceSpans: [{ claimText: text, utteranceIds: [cited], userPhrase: text }],
              },
            ],
          },
          candidateUpserts: [
            { id: candidateIdFor(cited), target: "idea", gist: text, addEvidenceIds: [cited] },
          ],
        };
      }
      // Relationship assembled across two utterances — span binding must block it.
      const [a, b] = [recent[0], recent[1] ?? recent[0]];
      if (!a || !b) return { mode: "question", text: pick(rng, PLAIN_QUESTIONS) };
      const text = `${a.text} leads to ${b.text}`;
      return {
        mode: "mirror",
        text: "assembled",
        mirror: {
          claims: [
            {
              id: "bad2",
              text,
              candidateId: candidateIdFor(a.id),
              target: "connection",
              sourceSpans: [
                { claimText: a.text, utteranceIds: [a.id], userPhrase: a.text },
                { claimText: b.text, utteranceIds: [b.id], userPhrase: b.text },
              ],
            },
          ],
        },
        candidateUpserts: [
          { id: candidateIdFor(a.id), target: "connection", gist: text, addEvidenceIds: [a.id, b.id] },
        ],
      };
    }

    // --- Clarify with a model-controlled span (userPhrase may be invented) ---
    if (roll < 0.72) {
      const cited = recent[0];
      const phrase = chance(rng, 0.4)
        ? `${INVENTED_MARKER} framing`
        : cited?.text ?? "that last part";
      return {
        mode: "clarify",
        text: "Which part of that is doing the most work for you?",
        clarifySpan: {
          claimText: phrase,
          utteranceIds: [cited?.id ?? "u_nonexistent"],
          userPhrase: phrase,
        },
      };
    }

    // --- Adversarial map commands: must never mint non-user structure ---
    if (roll < 0.88) {
      const cited = recent[0]?.id;
      const cards = ctx.map.thoughtUnits.filter((u) => u.role !== "connection_label" && u.text.trim());
      const commands: MapCommand[] = [];
      const attack = rng();
      if (attack < 0.4) {
        commands.push({
          kind: "create_card",
          text: `fabricated ${INVENTED_MARKER} notion`,
          sourceSpan: {
            userPhrase: `fabricated ${INVENTED_MARKER} notion`,
            utteranceIds: cited ? [cited] : [],
          },
        });
      } else if (attack < 0.6 && world.userCorpus.length > 2) {
        // Echo an OLD turn's phrase with this turn's id — stale-span attack.
        const old = world.userCorpus[Math.floor(rng() * (world.userCorpus.length - 1))]!;
        commands.push({
          kind: "create_card",
          text: old,
          sourceSpan: { userPhrase: old, utteranceIds: cited ? [cited] : [] },
        });
      } else if (attack < 0.7 && cards.length >= 1) {
        // Rewrite an existing card to invented model text — the edit gates must
        // refuse (replacement wording is not this turn's user words).
        commands.push({
          kind: "edit_card",
          cardText: cardRef(cards[0]!.id),
          newText: `${INVENTED_MARKER} rewritten meaning`,
          sourceSpan: {
            userPhrase: `${INVENTED_MARKER} rewritten meaning`,
            utteranceIds: cited ? [cited] : [],
          },
        });
      } else if (attack < 0.8 && cards.length >= 1) {
        commands.push({
          kind: "nest_card",
          childText: `${INVENTED_MARKER} child`,
          parentText: cards[0]!.text,
        });
      } else if (cards.length >= 2) {
        commands.push({
          kind: "connect_cards",
          sourceText: cards[0]!.text,
          targetText: cards[1]!.text,
          labelText: `${INVENTED_MARKER} bond`,
        });
      }
      return {
        mode: "question",
        text: pick(rng, PLAIN_QUESTIONS),
        mapCommands: commands,
        questionStance: "organize",
      };
    }

    // --- Meta lane abuse: claim an aside while smuggling structure. Every map
    //     command and candidate upsert on a honored meta turn must be dropped. ---
    if (roll < 0.92) {
      const cited = recent[0]?.id;
      const cards = ctx.map.thoughtUnits.filter((u) => u.role !== "connection_label" && u.text.trim());
      return {
        mode: "question",
        text: `${MODEL_PROSE_MARKER} sure, whatever you say`,
        metaIntent: pick(rng, ["emotional", "confused", "social", "off_topic", "unparseable"] as const),
        affect: pick(rng, ["exhausted", "frustrated", "overwhelmed", "energized"] as const),
        mapCommands: cards.length >= 1
          ? [{ kind: "create_card", text: `${INVENTED_MARKER} smuggled`, sourceSpan: { userPhrase: `${INVENTED_MARKER} smuggled`, utteranceIds: cited ? [cited] : [] } }]
          : undefined,
        candidateUpserts: [
          { id: `cand_meta_${Math.floor(rng() * 100)}`, target: "idea", gist: `${MODEL_PROSE_MARKER} aside`, addEvidenceIds: cited ? [cited] : [] },
        ],
      };
    }

    // --- Candidate churn: fake evidence ids, random deletes ---
    const fakeUpserts = [
      {
        id: `cand_fake_${Math.floor(rng() * 100)}`,
        target: pick(rng, ["idea", "hierarchy", "connection"] as const),
        gist: `${MODEL_PROSE_MARKER} speculative grouping`,
        addEvidenceIds: ["u_99999", recent[0]?.id ?? "u_0"],
      },
    ];
    return {
      mode: "question",
      text: pick(rng, PLAIN_QUESTIONS),
      candidateUpserts: fakeUpserts,
      candidateDeletes: chance(rng, 0.5) && ctx.candidates.length > 0
        ? [pick(rng, ctx.candidates).id]
        : undefined,
      carryForwardCandidateIds: ctx.candidates.length > 0 ? [pick(rng, ctx.candidates).id] : undefined,
    };
  };
}

// ---------------------------------------------------------------------------
// Invariant checks
// ---------------------------------------------------------------------------

const VALID_MODES = new Set(["question", "mirror", "clarify"]);
const MUTATION_KINDS = new Set(["create_card", "nest_card", "connect_cards", "edit_card"]);

function traceOf(world: FuzzWorld): string {
  const tail = world.log.slice(-8);
  return `seed=${world.seed}\n${tail
    .map((e) => `#${e.turn} [${e.kind}] user=${JSON.stringify(e.input)} -> ${e.outMode}: ${JSON.stringify(e.outText.slice(0, 90))}`)
    .join("\n")}`;
}

function isUserSubstring(world: FuzzWorld, text: string): boolean {
  const needle = normalize(text);
  if (!needle) return true;
  return world.userCorpus.some((entry) => normalize(entry).includes(needle));
}

function isUserVocabulary(world: FuzzWorld, text: string): boolean {
  return contentTokens(text).every((token) => world.corpusStems.has(stem(token)));
}

function checkCommandAuthorship(world: FuzzWorld, out: TurnOutput): void {
  for (const command of out.mapCommands ?? []) {
    const mintedTexts: string[] = [];
    if (command.kind === "create_card") mintedTexts.push(command.text);
    if (command.kind === "edit_card") mintedTexts.push(command.text);
    if (command.kind === "nest_card" && !("id" in command.child)) mintedTexts.push(command.child.text);
    if (command.kind === "connect_cards") {
      if (!("id" in command.source)) mintedTexts.push(command.source.text);
      if (!("id" in command.target)) mintedTexts.push(command.target.text);
      if (command.labelText) mintedTexts.push(command.labelText);
    }
    for (const text of mintedTexts) {
      expect(
        isUserSubstring(world, text),
        `I4 violation: command minted non-user text ${JSON.stringify(text)}\n${traceOf(world)}`,
      ).toBe(true);
    }
  }
}

function checkUnderstandingReadOnly(world: FuzzWorld, out: TurnOutput): void {
  if (!out.understanding) return;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.kind === "string" && MUTATION_KINDS.has(record.kind)) {
      expect.fail(`I5 violation: understanding snapshot carries a map-mutation command shape\n${traceOf(world)}`);
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === "command" || key === "mapCommands") {
        expect.fail(`I5 violation: understanding snapshot carries "${key}"\n${traceOf(world)}`);
      }
      walk(value);
    }
  };
  walk(out.understanding);
  const json = JSON.stringify(out.understanding).toLowerCase();
  expect(
    json.includes(MODEL_PROSE_MARKER) || json.includes(INVENTED_MARKER),
    `I5 violation: understanding snapshot leaked model prose\n${traceOf(world)}\nsnapshot=${json.slice(0, 600)}`,
  ).toBe(false);
}

function checkTurnInvariants(world: FuzzWorld, out: TurnOutput): void {
  expect(VALID_MODES.has(out.mode), `I2 violation: out.mode=${out.mode}\n${traceOf(world)}`).toBe(true);
  expect(VALID_MODES.has(world.state.mode), `I2 violation: state.mode=${world.state.mode}\n${traceOf(world)}`).toBe(true);
  expect(
    typeof out.text === "string" && out.text.trim().length > 0,
    `I2 violation: empty out.text\n${traceOf(world)}`,
  ).toBe(true);

  if (out.mode === "mirror") {
    expect(out.validatedMirror, `I3 violation: mirror without validatedMirror\n${traceOf(world)}`).toBeDefined();
    expect(out.text, `I3 violation: mirror text is not the fixed preamble\n${traceOf(world)}`).toBe(MIRROR_PREAMBLE);
    const eligible = world.state.bank.getAll().filter((u) => !u.commandOnly && !u.nonHarvestable);
    const revalidated = validateMirror(out.validatedMirror!.reflection, eligible, world.config);
    expect(
      revalidated.ok,
      `I3 violation: shipped mirror fails re-validation\n${traceOf(world)}`,
    ).toBe(true);
    for (const claim of out.validatedMirror!.reflection.claims) {
      expect(
        isUserVocabulary(world, claim.text),
        `I3 violation: mirrored claim uses non-user vocabulary: ${JSON.stringify(claim.text)}\n${traceOf(world)}`,
      ).toBe(true);
    }
  }

  // I7: a fenced meta aside never authors or harvests structure.
  if (out.suppressionReason === "meta_aside") {
    expect(
      (out.mapCommands ?? []).length,
      `I7 violation: meta_aside turn carried map commands\n${traceOf(world)}`,
    ).toBe(0);
  }

  checkCommandAuthorship(world, out);
  checkUnderstandingReadOnly(world, out);
}

function checkMapAuthorship(world: FuzzWorld): void {
  for (const unit of world.store.getAll()) {
    if (!unit.text.trim()) continue;
    expect(
      isUserVocabulary(world, unit.text),
      `I4 violation: map card carries non-user vocabulary: ${JSON.stringify(unit.text)}\n${traceOf(world)}`,
    ).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Wedge probe
// ---------------------------------------------------------------------------

/**
 * Transient fields that MUST clear under the canonical escape sequence.
 * `activeSelectionContext` is deliberately excluded for now: it persists by
 * design until the next mirror/large turn (advisory-only) — tracked separately
 * as a stale-influence note, not a wedge.
 */
const MUST_CLEAR_FIELDS = [
  "clarifyTarget",
  "pendingMapCommand",
  "organizeFocus",
  "coverageFocus",
  "pendingChildPlacement",
  "activeElicitation",
  "pendingCardWording",
  "captureLoop",
] as const;

type MustClearField = (typeof MUST_CLEAR_FIELDS)[number];

const WEDGE_PROBE_AT = 10;

const ESCAPE_SEQUENCE = [
  "cancel",
  "cancel",
  "let's move on",
  "honestly the bigger picture is about trust and oversight now",
] as const;

async function runTurn(world: FuzzWorld, input: FuzzInput, llm: MockLLM): Promise<TurnOutput> {
  if (input.text.trim() && input.options?.ingestUser !== false) {
    addToCorpus(world, input.text);
  }
  let out: TurnOutput;
  try {
    out = await processTurn(
      world.state,
      input.text,
      llm,
      world.config,
      "chat",
      world.store.toLLMContext(),
      { requireConnectionLabel: world.requireConnectionLabel, ...input.options },
    );
  } catch (error) {
    throw new Error(
      `I1 violation: processTurn threw on [${input.kind}] ${JSON.stringify(input.text)}\n${traceOf(world)}\n${String(error)}`,
    );
  }
  world.log.push({
    turn: world.log.length + 1,
    input: input.text,
    kind: input.kind,
    outMode: out.mode,
    outText: out.text,
  });
  checkTurnInvariants(world, out);
  if (out.mapCommands && out.mapCommands.length > 0) {
    applyAcceptedMapCommands(out.mapCommands, world.store, world.state.bank);
    checkMapAuthorship(world);
  }
  return out;
}

async function runEscapeProbe(world: FuzzWorld, llm: MockLLM, wedgedField: MustClearField): Promise<void> {
  world.forcePlain = true;
  for (const text of ESCAPE_SEQUENCE) {
    await runTurn(world, { kind: "escape", text }, llm);
  }
  world.forcePlain = false;
  for (const field of MUST_CLEAR_FIELDS) {
    expect(
      world.state[field],
      `I6 violation: ${field} survived the canonical escape sequence (probe triggered by ${wedgedField})\n${traceOf(world)}`,
    ).toBeUndefined();
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function makeWorld(seed: number, config: MindmapConfig): FuzzWorld {
  const rng = mulberry32(seed);
  const world: FuzzWorld = {
    state: createState(),
    store: new ThoughtUnitStore(),
    config,
    rng,
    seed,
    userCorpus: [],
    corpusStems: new Set(),
    log: [],
    forcePlain: false,
    requireConnectionLabel: chance(rng, 0.5),
  };
  // Seed the map with 0-3 sovereign user cards (canvas-authored), sharing the bank.
  const seedCards = Math.floor(rng() * 4);
  for (let i = 0; i < seedCards; i++) {
    const text = pick(rng, TOPIC_PHRASES);
    const utterance = world.state.bank.add(text, "node_edit");
    world.store.addFromUserUtterance(utterance);
    addToCorpus(world, text);
  }
  return world;
}

async function fuzzRun(seed: number, turns: number, config: MindmapConfig): Promise<void> {
  const world = makeWorld(seed, config);
  const llm = buildAdversarialLLM(world);
  const setStreak = new Map<MustClearField, number>();

  for (let i = 0; i < turns; i++) {
    const input = nextUserInput(world);
    await runTurn(world, input, llm);

    // Occasionally exercise sovereign map actions: delete a card mid-flight so
    // stale pending references get covered, or user-edit a card's wording.
    if (chance(world.rng, 0.04)) {
      const cards = world.store.getAll().filter((u) => u.role !== "connection_label");
      if (cards.length > 0) world.store.delete(pick(world.rng, cards).id);
    }
    if (chance(world.rng, 0.04)) {
      const cards = world.store.getAll().filter((u) => u.role !== "connection_label");
      if (cards.length > 0) {
        const text = substantiveSentence(world.rng);
        world.store.editText(pick(world.rng, cards).id, text, world.state.bank);
        addToCorpus(world, text);
      }
    }

    for (const field of MUST_CLEAR_FIELDS) {
      const streak = world.state[field] !== undefined ? (setStreak.get(field) ?? 0) + 1 : 0;
      setStreak.set(field, streak);
      if (streak >= WEDGE_PROBE_AT) {
        await runEscapeProbe(world, llm, field);
        for (const key of MUST_CLEAR_FIELDS) setStreak.set(key, 0);
        break;
      }
    }
  }

  // End-of-run: every session must be escapable regardless of streaks.
  await runEscapeProbe(world, llm, "clarifyTarget");
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

const TURNS_PER_RUN = 60;

describe("fuzz: processTurn invariants (default config)", () => {
  for (let seed = 1; seed <= 40; seed++) {
    it(`holds all invariants for seed ${seed}`, async () => {
      await fuzzRun(seed, TURNS_PER_RUN, defaultConfig);
    });
  }
});

describe("fuzz: processTurn invariants (readiness/pacing opened up)", () => {
  const openConfig: MindmapConfig = {
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
    },
  };
  for (let seed = 101; seed <= 140; seed++) {
    it(`holds all invariants for seed ${seed}`, async () => {
      await fuzzRun(seed, TURNS_PER_RUN, openConfig);
    });
  }
});

describe("fuzz: processTurn invariants (map-lean slider)", () => {
  const mapLean = withQuestionIntentBias(defaultConfig, 100);
  for (let seed = 201; seed <= 220; seed++) {
    it(`holds all invariants for seed ${seed}`, async () => {
      await fuzzRun(seed, TURNS_PER_RUN, mapLean);
    });
  }
});
