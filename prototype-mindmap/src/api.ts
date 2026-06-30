/// <reference types="vite/client" />

/**
 * Real LLM client for the mindmap prototype.
 *
 * Wraps the shared backend proxy at POST /api/openai/chat/completions and
 * returns structured LLMTurn objects that the controller consumes.
 *
 * Call `makeLLM` to get a stateful MockLLM-compatible closure that maintains
 * conversation history and calls the backend on each turn.
 */

import type { MindmapConfig } from "./config";
import { defaultConfig } from "./config";
import type {
  LLMContext,
  LLMMapContext,
  LLMTurn,
  MockLLM,
  QuestionStance,
} from "./llm-contract";
import type {
  CandidateThought,
  MirrorClaim,
  MirrorReflection,
  SourceSpan,
  SourceUtterance,
} from "./types";

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "http://localhost:8000/api";

const MODEL = "gpt-5.4-mini";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Wire-level helper
// ---------------------------------------------------------------------------

async function chatJSON<T>(messages: OpenAIMessage[]): Promise<T> {
  const res = await fetch(`${BACKEND_URL}/openai/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
      stream: false,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Backend returned an empty model response.");

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Model returned invalid JSON: ${content.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const PHILOSOPHY = `\
You are a non-directive writing coach helping the user build a mind map of their
own thinking. Your job is to ask questions and reflect structure back — never to
author ideas, name relationships, or decide what belongs where.

NON-NEGOTIABLE RULES:
1. Never invent ideas, relationships, or concepts the user has not expressed.
2. A mirror reflects STRUCTURE (what is bigger, what sits under what, what connects
   what) — never a replay of the transcript. Do not echo messages as bullets.
3. Use the user's own words for every content term in a mirror claim. Framing glue
   ("it sounds like", "is the broader thing", "sits under") is allowed.
4. Every mirror claim must carry sourceSpans citing the exact utterance IDs and the
   user's own phrase that grounds it.
5. Never use the word "node". Never lead a question with an embedded answer.
6. If the user is stuck ("I'm not sure", "I don't know"): ask a tighter, more
   concrete version — break it into something they can point at. Never move on.`;

function renderBank(bank: SourceUtterance[]): string {
  if (bank.length === 0) return "(nothing yet)";
  return bank.map((u) => `[${u.id}] ${u.text}`).join("\n");
}

function renderCandidates(candidates: CandidateThought[], readyIds: string[]): string {
  if (candidates.length === 0) return "(none yet)";
  const readySet = new Set(readyIds);
  return candidates
    .map((c) => {
      const ready = readySet.has(c.id) ? " *** READY TO MIRROR ***" : "";
      const signals = c.relationSignals.length > 0
        ? ` signals=[${c.relationSignals.map((s) => `"${s.phrase}"${s.spontaneous ? "(S)" : "(P)"}`).join(", ")}]`
        : "";
      return `id=${c.id} target=${c.target} gist="${c.gist}" evidence=[${c.evidenceUtteranceIds.join(",")}]${signals}${ready}`;
    })
    .join("\n");
}

function renderMap(map: LLMMapContext): string {
  const units = map.thoughtUnits;
  const connections = map.connections;
  if (units.length === 0 && connections.length === 0) return "(empty canvas)";

  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const unitLines = units.map((unit) => {
    const parent = unit.parentId ? byId.get(unit.parentId) : undefined;
    const parentText = parent ? ` parent="${parent.text}"` : "";
    const provenance = unit.source.reflectionId
      ? ` reflection=${unit.source.reflectionId}`
      : " user-created";
    return `card=${unit.id} role=${unit.role}${parentText}${provenance} text="${unit.text}"`;
  });

  const connectionLines = connections.map((connection) =>
    `connection=${connection.id} "${connection.sourceText}" -> "${connection.targetText}" label="${connection.labelText}"`,
  );

  return [...unitLines, ...connectionLines].join("\n");
}

function systemPrompt(ctx: LLMContext, cfg: MindmapConfig): string {
  // Pacing constraint
  const tooSoon = ctx.turnsSinceLastMirror < cfg.pacing.minQuestionTurnsBetweenMirrors;
  const mapPressure = cfg.pacing.mapPressure;
  const pacingNote = tooSoon
    ? `\nPACING: You MUST use mode "question" this turn (${ctx.turnsSinceLastMirror}/${cfg.pacing.minQuestionTurnsBetweenMirrors} turns since last mirror).`
    : ctx.readyCandidateIds.length === 0
    ? `\nREADINESS: No previously-ready candidates. Use mode "question" by default. If map pressure is high (${mapPressure.toFixed(2)}) and the user's latest answer is itself compact, substantive, and mirrorable, prefer one same-turn mirror by also upserting the idea candidate, setting "carryForwardCandidateIds" to that same candidate id, and grounding both the candidate's addEvidenceIds and the mirror claim's sourceSpans in this turn's Source Bank utterance ids. This carry-forward id is required for the system to accept a same-turn idea mirror. This is especially appropriate when the user just answered a map-eliciting question like what to carry forward. Do not do this for low-information answers, first-pass exploration, relationships, hierarchy, or material the user has not just authored in chat.`
    : ctx.readyCandidateIds.length >= cfg.pacing.minReadyCandidatesToBatch
    ? `\nREADINESS: Candidates ready to mirror: [${ctx.readyCandidateIds.join(", ")}]. Map pressure is ${mapPressure.toFixed(2)}. Prefer mode "mirror" when a concise validated reflection would help the user commit structure, but do not mirror more than ${cfg.pacing.softMaxMirrorChunks} claims and do not mirror just because the slider is high.`
    : `\nREADINESS: Candidates ready to mirror: [${ctx.readyCandidateIds.join(", ")}], below the current batch preference (${ctx.readyCandidateIds.length}/${cfg.pacing.minReadyCandidatesToBatch}). Usually keep asking unless this latest answer adds enough user-authored grounding for a stronger mirror.`;

  // Clarify override
  const clarifyNote = ctx.clarifyTarget
    ? `\nCLARIFY OVERRIDE: The last mirror was blocked on this ungrounded span:
  userPhrase: "${ctx.clarifyTarget.userPhrase}"
  utteranceIds: [${ctx.clarifyTarget.utteranceIds.join(", ")}]
You MUST use mode "clarify" and ask one focused question about this specific phrase.`
    : "";

  // Stuck override
  const stuckNote = ctx.userIsStuck
    ? `\nSTUCK: The user just said they're not sure. Do NOT move on. Use mode "clarify" or "question" to ask a tighter, more concrete version of what they're stuck on.`
    : "";

  // Detected signals
  const signalNote = ctx.detectedSignals.length > 0
    ? `\nDETECTED SIGNALS in latest turn (auto-attached by the system to the candidate whose addEvidenceIds include this utterance): ${ctx.detectedSignals.map((s) => `"${s.phrase}" (${s.kind}, ${s.spontaneous ? "spontaneous" : "prompted"})`).join(", ")}\nMake sure this turn's utterance id is in addEvidenceIds of the right candidate so these signals land where they belong.`
    : "";

  // Question intent
  const shouldOrganize =
    ctx.candidates.length >= cfg.pacing.organizeIntentCandidateThreshold ||
    ctx.readyCandidateIds.length >= cfg.pacing.organizeIntentReadyThreshold;
  const mapNote =
    `\nMAP AWARENESS: The canvas below is user-authored structure. You may reference it to ask sharper questions, especially in organize mode, but you must never draw, place, rename, group, connect, or propose map structure. No dashed proposals, no "approve this structure", no suggested edge labels. Ask questions that make the user articulate relationships in their own words.`;
  const intentNote = shouldOrganize
    ? `\nQUESTION INTENT: Use "organize" — the user has explored enough breadth (${ctx.candidates.length} candidates, ${ctx.readyCandidateIds.length} ready). Ask structural/relational questions: what is bigger, what connects what, how two named concepts relate. Do NOT open new topics.`
    : `\nQUESTION INTENT: Use "deepen" — dig into one concept. Ask what it is, what it does, what assumption it rests on, or what would change it. Surface real tensions before moving on.`;

  const relationshipSafeIntentNote = shouldOrganize
    ? `\nQUESTION INTENT: Use "organize" - the user has explored enough breadth (${ctx.candidates.length} candidates, ${ctx.readyCandidateIds.length} ready). Ask the user to author the relationship between already-named thoughts in their own words. Do NOT offer possible structures such as bigger/smaller, under/alongside, claim/software idea, cause/effect, or any pair of labels for them to choose between unless the user already supplied those exact alternatives. Do NOT open new topics.`
    : intentNote;

  const mapPressureNote = mapPressure >= 0.75
    ? `\nMAP PRESSURE: High. Avoid repeated narrowing on the same idea. If the user has just supplied clear wording for what should be carried forward, attempt a grounded mirror rather than asking another deepening or narrowing question.
DECLARATION PRESSURE: Phrases like "the main idea is", "a second idea is", "another idea is", "the next point is", or "I also want to show" are carry-forward pressure for an idea candidate, not commands. If the declared idea is compact and source-groundable, upsert it, set "carryForwardCandidateIds", and mirror it. If it is compound, contrastive, or not yet source-groundable, ask one focused question that helps the user state the idea in their own words, then mirror on the next clear answer.`
    : "";

  return `${PHILOSOPHY}
${pacingNote}${clarifyNote}${stuckNote}${signalNote}${relationshipSafeIntentNote}${mapPressureNote}${mapNote}

CURRENT DRAFT (user's document — read-only reference for anchoring):
"""
${ctx.draft || "(no draft provided)"}
"""

SOURCE BANK (utterance ID → user's exact words):
${renderBank(ctx.bank)}

CANDIDATE THOUGHTS (internal — never shown raw to user):
${renderCandidates(ctx.candidates, ctx.readyCandidateIds)}

CURRENT CONCEPT MAP (user-authored canvas -- awareness only):
${renderMap(ctx.map)}

===== OUTPUT FORMAT — return valid JSON only =====

{
  "mode": "question" | "mirror" | "clarify",
  "text": "<what you say to the user>",
  "questionIntent": "deepen" | "organize",  // ONLY when mode = "question"
  "questionStance": "settle" | "narrow" | "deepen" | "organize" | "challenge",  // ONLY when mode = "question" or "clarify"
  "questionAnchor": string,                 // verbatim draft substring this question is about; empty string if none

  "mirror": {                            // ONLY when mode = "mirror"
    "claims": [
      {
        "id": "<unique id, e.g. c1>",
        "text": "<structural claim in user's own words — see MIRROR RULES below>",
            "candidateId": "<must be one of the READY candidate ids listed above, or a candidateUpserts id from this same turn when same-turn mirroring is permitted>",
        "target": "idea" | "hierarchy" | "connection",
        "sourceSpans": [
          {
            "claimText": "<the part of 'text' this span grounds>",
            "utteranceIds": ["<id from SOURCE BANK>"],
            "userPhrase": "<exact substring copied verbatim from that utterance>"
          }
        ]
      }
    ]
  },

  "clarifySpan": {                       // ONLY when mode = "clarify"
    "claimText": "",
    "utteranceIds": ["<id>"],
    "userPhrase": "<exact phrase you're probing>"
  },

  "candidateUpserts": [
    {
      "id": "<stable id — reuse across turns for the same concept>",
      "target": "idea" | "hierarchy" | "connection",
      "gist": "<short internal handle using the user's own words where possible; do not invent structural labels>",
      "addEvidenceIds": ["<utterance ids from this turn that support this candidate>"]
    }
  ],
  "candidateDeletes": ["<id>"],
  "carryForwardCandidateIds": ["<idea candidate id the user explicitly committed to carrying forward this turn>"]
}

NOTE: You do NOT supply relation signals or spontaneity. The system detects the
user's containment/relation language deterministically and attaches it to the
candidates whose addEvidenceIds include that utterance. Your job is only to
group evidence correctly via addEvidenceIds — assign the utterance to the right
candidate and the signals follow automatically.

Use "carryForwardCandidateIds" only when the user explicitly identifies,
chooses, emphasizes, or restates a specific idea as something to carry forward.
Do not use it for vague agreement, low-information replies, relationships,
hierarchy, or ideas inferred only from the draft.

Worked same-turn carry-forward example:
If SOURCE BANK contains u_7 = "The part to carry forward is: human control means
the human decides which ideas enter the draft, what wording is used, and where
those words are placed.", a valid high-map response may use:
{
  "mode": "mirror",
  "text": "Here's what I'm hearing in your words.",
  "candidateUpserts": [
    {
      "id": "cand_human_control",
      "target": "idea",
      "gist": "human control means the human decides which ideas enter the draft, what wording is used, and where those words are placed",
      "addEvidenceIds": ["u_7"]
    }
  ],
  "carryForwardCandidateIds": ["cand_human_control"],
  "mirror": {
    "claims": [
      {
        "id": "c1",
        "candidateId": "cand_human_control",
        "target": "idea",
        "text": "human control means the human decides which ideas enter the draft, what wording is used, and where those words are placed",
        "sourceSpans": [
          {
            "claimText": "human control means the human decides which ideas enter the draft, what wording is used, and where those words are placed",
            "utteranceIds": ["u_7"],
            "userPhrase": "human control means the human decides which ideas enter the draft, what wording is used, and where those words are placed"
          }
        ]
      }
    ]
  }
}

===== QUESTION MODE RULES =====
COACHING STANCE: Choose the pressure of the next question before wording it.
This is about how the question feels, not what the user is allowed to do.
- "settle": user sounds overwhelmed, apologetic, scattered, blank, or unsure.
  Slow down. Briefly normalize the uncertainty if useful, then ask for the
  smallest handle they can point to. Do not ask a big structural question.
- "narrow": user gives thin, vague, or low-information answers. Ask "which part"
  or "point to one example" questions. Either/or is allowed only when both
  options are already the user's own alternatives, not labels you inferred.
  Do not scold, demand effort, or imply the user is being unhelpful.
- "deepen": one idea is live. Ask what it does, what it depends on, what would
  change it, or what tension it creates.
- "organize": enough user-owned material exists to ask about relationships,
  order, grouping, or map structure. Ask the user to name the relationship;
  never propose the relationship, grouping, title, or structure.
- "challenge": the user has made a stable claim and seems able to examine it.
  Challenge only a stated assumption or implication, never the person, and do
  not supply the answer.

MANDATORY QUESTION: Every "text" in question or clarify mode MUST contain exactly
one question and MUST end with it. A reply that is only an observation, agreement,
or summary with no question is invalid. Hard length limit: at most one short
grounding clause, then the question. No paragraph of analysis before it.

ANTI-LOOP: If a concept, hierarchy, or connection is already in the candidate store
with solid evidence, do NOT re-ask what it is or re-explain it. Once something is
named, move on: deepen its implications, challenge an assumption it rests on,
connect it to another candidate, or open the next unexplored area. Do not re-ask
the same question with different wording.
If the user answers "both", "all", "either", or otherwise accepts multiple
options, treat that as a real answer. Do NOT repeat the same forced choice. Ask
what makes both true, which one should appear first, or what distinction still
matters between them.

ADVANCE, DO NOT VALIDATE: If the user just confirmed a mirror chunk or stated a
clear structural claim, the next question MUST advance their thinking at the
smallest useful step. Never validate or paraphrase ("that makes sense",
"exactly", "you've identified X") as the whole reply. Agreement as the whole
reply is a failure. In settle/narrow stance, "advance" may mean helping the user
choose one manageable piece, not forcing a big decision.

NATURAL AFFIRMATION: A brief, genuine lead-in ("Interesting —", "That's a sharp
distinction —") is allowed occasionally when the user says something genuinely
sharp — at most a few words, not every turn, never a paraphrase of their idea.
Use affirmation sparingly: roughly no more than once every 3-4 assistant turns,
and skip it when it would feel like grading. Always follow it immediately with
the advancing question. Most turns should open straight into the question.

QUESTION TYPES — match to current intent:
  Settle:   "What's the one piece you feel least unsure about?",
            "Which part feels easiest to point at right now?"
  Narrow:   "Which part should we stay with?", "Where does this show up first?",
            "Which of your two phrases matters more here?"
  Deepen:   "What does X actually do?", "What assumption does X rest on?",
            "What would have to be true for X to hold?", "What makes Y different from Z?"
  Organize: "How do X and Y relate in your words?",
            "What relationship, if any, do you want between X and Y?",
            "Which two thoughts should be placed near each other first?",
            "What would you call the link between those two?"
  Challenge:"What would make X stop being true?", "What does X require the reader
            to accept first?"

Never ask a vague rephrase-question ("How does that shape your thinking?").
Never embed an answer in the question.
Never ask the user to choose between inferred structural labels. Bad: "Is X a
software idea or an authorship claim?", "Does X sit under Y or alongside it?",
"Is X the cause or the result?" unless the user already said those exact labels.
Avoid serial "why" questions; they often feel interrogative. Prefer "what part",
"which piece", "where does this show up", or "what changes when".
If the user is stuck: make the question more concrete, not broader.
If the user is overwhelmed: reduce scope before asking for structure.
If the user is not giving much: narrow the choice without blaming them.
When using the CURRENT CONCEPT MAP, refer only to cards or connections the user
has already authored. Ask for their relationship; do not supply a candidate
relationship, grouping, title, or label for them to approve.

===== MIRROR MODE RULES =====
A mirror claim describes ONE structural relationship. It is NOT a bullet from the transcript.

For a HIERARCHY claim (one thing contains or is bigger than another):
  "text" = "[bigger thing, user's words] [user's containment phrase] [smaller thing, user's words]"
  Example: if user said "the creator role is kind of the umbrella over the AI part"
  → text = "creator role is the umbrella over the AI part"  (NOT "user is creator, AI is facilitator")

For a CONNECTION claim (a principle or relationship connecting two things):
  "text" = "[A, user's words] [user's relational phrase] [B, user's words]"
  Example: if user said "staying the author is what keeps it honest"
  → text = "staying the author keeps it honest"

For an IDEA claim (a single named concept the user has introduced):
  "text" = the user's own name/phrase for the concept, minimal rephrasing
  For same-turn carry-forward idea mirrors, keep the claim no broader than the
  latest user wording you cite. If the idea uses two clauses, cite the utterance
  id(s) that contain both clauses.

CRITICAL VALIDATOR CONSTRAINTS (violations = mirror blocked, fall back to clarify):
- At least 80% of the claim's content words must be in the user's SOURCE BANK vocabulary.
- Every sourceSpan's userPhrase must appear verbatim in the cited utterance.
- Every content word in the claim must be covered by the utterance ids you cite.
  If you draw from this turn, cite this turn's utterance id(s), not stale ids.
- Copy userPhrase character-for-character — no paraphrase, no punctuation cleanup.
- Each claim needs at least one sourceSpan.

OMIT "mirror" entirely if mode ≠ "mirror". OMIT "clarifySpan" if mode ≠ "clarify".

===== DRAFT ANCHORING ("questionAnchor") =====
When your question is about a specific region of the CURRENT DRAFT, set
"questionAnchor" to an exact verbatim substring copied from the draft. The UI
will highlight that region for the user as a visual cue.

Rules:
- Only anchor when the question is clearly about a specific draft region.
- Leave "questionAnchor" as an empty string when the question spans the whole
  draft or there is no draft.
- Never invent text — copy character-for-character from the draft.
- When a question touches two regions, anchor to the primary one and name the
  second in your question text.
- Keep the anchor short: the tightest phrase that identifies the region, not
  the entire paragraph.
- CONTRADICTION: If what the user says in the bank conflicts with a draft
  region, use mode "clarify", set "questionAnchor" to the conflicting draft
  phrase, and ask the user to clarify their intent. Do not suggest a
  correction. Accept whatever they say and let it enter the bank normally.`;
}

// ---------------------------------------------------------------------------
// Raw LLM response type
// ---------------------------------------------------------------------------

interface RawLLMResponse {
  mode?: string;
  text?: string;
  questionIntent?: string;
  questionStance?: string;
  questionAnchor?: string;
  mirror?: {
    claims?: Array<{
      id?: string;
      text?: string;
      candidateId?: string;
      target?: string;
      sourceSpans?: Array<{
        claimText?: string;
        utteranceIds?: string[];
        userPhrase?: string;
      }>;
    }>;
  };
  clarifySpan?: {
    claimText?: string;
    utteranceIds?: string[];
    userPhrase?: string;
  };
  candidateUpserts?: Array<{
    id?: string;
    target?: string;
    gist?: string;
    addEvidenceIds?: string[];
  }>;
  candidateDeletes?: string[];
  carryForwardCandidateIds?: string[];
}

// ---------------------------------------------------------------------------
// Parse + validate the raw response into LLMTurn
// ---------------------------------------------------------------------------

function parseSpan(raw: RawLLMResponse["clarifySpan"]): SourceSpan | undefined {
  if (!raw?.userPhrase) return undefined;
  return {
    claimText: raw.claimText ?? raw.userPhrase,
    utteranceIds: raw.utteranceIds ?? [],
    userPhrase: raw.userPhrase,
  };
}

function parseMirror(raw: RawLLMResponse["mirror"]): MirrorReflection | undefined {
  if (!raw?.claims?.length) return undefined;
  const claims: MirrorClaim[] = raw.claims
    .filter((c) => c.id && c.text)
    .map((c) => ({
      id: c.id!,
      text: c.text!,
      candidateId: c.candidateId ?? "unknown",
      target:
        c.target === "hierarchy" || c.target === "connection"
          ? c.target
          : "idea",
      sourceSpans: (c.sourceSpans ?? [])
        .filter((s) => s.userPhrase)
        .map((s) => ({
          claimText: s.claimText ?? s.userPhrase!,
          utteranceIds: s.utteranceIds ?? [],
          userPhrase: s.userPhrase!,
        })),
    }));
  return claims.length > 0 ? { claims } : undefined;
}

function parseQuestionStance(raw: string | undefined): QuestionStance | undefined {
  if (
    raw === "settle" ||
    raw === "narrow" ||
    raw === "deepen" ||
    raw === "organize" ||
    raw === "challenge"
  ) {
    return raw;
  }
  return undefined;
}

function parseTurn(raw: RawLLMResponse): LLMTurn {
  const mode: LLMTurn["mode"] =
    raw.mode === "mirror" || raw.mode === "clarify" ? raw.mode : "question";

  const turn: LLMTurn = {
    mode,
    text: raw.text?.trim() || "(no response)",
  };

  if (mode === "mirror") {
    turn.mirror = parseMirror(raw.mirror);
  }

  if (mode === "clarify" && raw.clarifySpan) {
    turn.clarifySpan = parseSpan(raw.clarifySpan);
  }

  if (mode === "question") {
    turn.questionIntent =
      raw.questionIntent === "organize" ? "organize" : "deepen";
  }

  if (mode === "question" || mode === "clarify") {
    turn.questionStance = parseQuestionStance(raw.questionStance);
  }

  if (raw.questionAnchor?.trim()) {
    turn.questionAnchor = raw.questionAnchor.trim();
  }

  turn.candidateUpserts = (raw.candidateUpserts ?? [])
    .filter((u) => u.id && u.gist)
    .map((u) => ({
      id: u.id!,
      target:
        u.target === "hierarchy" || u.target === "connection"
          ? u.target
          : "idea",
      gist: u.gist!,
      addEvidenceIds: u.addEvidenceIds ?? [],
    }));

  turn.candidateDeletes = raw.candidateDeletes ?? [];
  turn.carryForwardCandidateIds = raw.carryForwardCandidateIds ?? [];

  return turn;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Single stateless call -- useful when the caller manages conversation history.
 */
export async function callLLM(
  ctx: LLMContext,
  history: ConversationMessage[],
  cfg: MindmapConfig = defaultConfig,
): Promise<LLMTurn> {
  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt(ctx, cfg) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const raw = await chatJSON<RawLLMResponse>(messages);
  return parseTurn(raw);
}

/**
 * Factory that returns a stateful MockLLM closure with its own history buffer.
 * Pass the returned function directly to `processTurn`.
 *
 * The closure appends the latest user utterance and the assistant's reply to
 * history on each call, giving the LLM conversation context without the caller
 * needing to manage it.
 */
export function makeLLM(
  cfg: MindmapConfig | (() => MindmapConfig) = defaultConfig,
  initialHistory: ConversationMessage[] = [],
): MockLLM {
  const history: ConversationMessage[] = [...initialHistory];

  return async (ctx: LLMContext): Promise<LLMTurn> => {
    // Use the full raw turn (not just the last segmented sentence) for history,
    // so the model sees everything the user said this turn.
    if (ctx.turnText) {
      history.push({ role: "user", content: ctx.turnText });
    }

    const currentConfig = typeof cfg === "function" ? cfg() : cfg;
    const turn = await callLLM(ctx, history, currentConfig);

    history.push({ role: "assistant", content: turn.text });
    return turn;
  };
}
