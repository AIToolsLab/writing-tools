/// <reference types="vite/client" />

// ── Domain types ──────────────────────────────────────────────────────────
export interface ProsCons {
  pros: string[];
  cons: string[];
}
/** A bubble's sync state relative to the draft. */
export type NodeStatus =
  | "synced" // present in both the mindmap and the draft
  | "new" // in the mindmap, not yet written into the draft
  | "draftOnly"; // a point the draft makes that no bubble represented
export interface IdeaNode {
  id: string;
  label: string; // the user's idea, editable
  expansions: string[]; // branching DIRECTIONS, not generated content
  status: NodeStatus;
}
export interface IdeaEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}
/** A candidate idea the AI proposes — the writer decides whether to keep it. */
export interface CandidateIdea {
  label: string;
  expansions: string[];
}
/** Edges reference candidate ideas by index, resolved to ids once selected. */
export interface Proposal {
  ideas: CandidateIdea[];
  edges: { source: number; target: number; label?: string }[];
}
export interface EditReflection {
  question: string; // metacognitive prompt
  prosCons: ProsCons; // what the edit gains / loses
}
/** The gap between the planned idea map and what the draft actually says. */
export interface PlanDraftGap {
  missingFromDraft: string[]; // map ideas the draft hasn't addressed
  notInMap: string[]; // draft points absent from the idea map
}
/** Result of comparing every bubble against the draft. */
export interface SyncResult {
  syncedIds: string[]; // ids of bubbles the draft actually covers
  draftOnly: string[]; // draft points no bubble represented
}
/** Where a bubble should be inserted into the draft, and whether it's ready. */
export interface DraftLocation {
  anchor: string; // exact draft substring to insert AFTER; "" = append at end
  enough: boolean; // is the idea developed enough to insert meaningfully?
}

// ── Backend client ────────────────────────────────────────────────────────
// The existing writing-tools backend exposes an OpenAI-compatible proxy at
// `${BACKEND}/openai/chat/completions` that injects the server-held API key.
const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "http://localhost:8000/api";
const MODEL = "gpt-4o";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One non-streaming call asking the model for a JSON object. */
async function chatJSON<T>(messages: ChatMessage[]): Promise<T> {
  const resp = await fetch(`${BACKEND_URL}/openai/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.4,
      stream: false,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Backend ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from model");
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`Model returned non-JSON: ${content.slice(0, 200)}`);
  }
}

let nodeCounter = 0;
export const freshId = (prefix: string) =>
  `${prefix}-${Date.now()}-${nodeCounter++}`;

// The product's philosophy, injected into every prompt: augment, never automate.
const PHILOSOPHY = `You are a thinking partner for a writer. Your role is to AUGMENT the
writer's cognition, never to AUTOMATE it. You organize and reflect; you do NOT
write polished prose or decide for the writer. You surface structure, directions,
and tradeoffs so the writer stays the expressive subject of their own work.`;

/**
 * Pipeline step 2 (input-stage agency): the AI only PROPOSES candidate ideas it
 * detects in the brain-dump. It does NOT organize a finished list — the writer
 * decides which candidates are truly theirs. Edges are suggested by index.
 */
export async function proposeIdeas(raw: string): Promise<Proposal> {
  const result = await chatJSON<{
    ideas?: { label?: string; expansions?: string[] }[];
    edges?: { source?: number; target?: number; label?: string }[];
  }>([
    { role: "system", content: PHILOSOPHY },
    {
      role: "user",
      content: `Here is a writer's scattered, spoken-style brain-dump for an essay.
Identify the distinct candidate ideas it CONTAINS. Do NOT write the essay and do
NOT decide what matters — you are only proposing options the writer will choose
from. Treat scatteredness as raw material.

Return a JSON object with this exact shape:
{
  "ideas": [{                    // each distinct candidate idea you detect
    "label": string,             // the idea in the writer's own words, short
    "expansions": string[]       // 2-4 DIRECTIONS this idea could branch into (questions/angles, NOT written content)
  }],
  "edges": [{                    // possible connections between candidate ideas
    "source": number,            // index into ideas[]
    "target": number,            // index into ideas[]
    "label": string              // 1-3 word relationship, optional
  }]
}

Propose 3-6 candidate ideas. Keep everything in the writer's voice and language.

Brain-dump:
"""
${raw}
"""`,
    },
  ]);

  const ideas: CandidateIdea[] = (result.ideas ?? []).map((n) => ({
    label: n.label ?? "(untitled idea)",
    expansions: n.expansions ?? [],
  }));

  const edges = (result.edges ?? [])
    .filter(
      (e) =>
        typeof e.source === "number" &&
        typeof e.target === "number" &&
        ideas[e.source] &&
        ideas[e.target] &&
        e.source !== e.target,
    )
    .map((e) => ({
      source: e.source as number,
      target: e.target as number,
      label: e.label,
    }));

  return { ideas, edges };
}

/** The signature interaction: reflect a node edit back — ask why, show tradeoffs. */
export async function reflectOnEdit(
  oldLabel: string,
  newLabel: string,
  essayContext: string,
): Promise<EditReflection> {
  return chatJSON<EditReflection>([
    { role: "system", content: PHILOSOPHY },
    {
      role: "user",
      content: `The writer just changed one idea in their mindmap.

Before: "${oldLabel}"
After:  "${newLabel}"

Overall essay context (other ideas): ${essayContext || "(none yet)"}

Reflect this edit back to the writer. Return JSON:
{
  "question": string,   // ONE short metacognitive question asking why they made this change / what they're after
  "pros": string[],     // 1-3 things this specific edit GAINS for the essay
  "cons": string[]      // 1-3 things it LOSES or risks
}

Do NOT tell them what to write. Prompt their own reflection.`,
    },
  ]);
}

/**
 * Flesh out a bare idea node with branching directions to develop it, so it
 * matches the depth of AI-proposed ideas. Still only directions, never prose.
 */
export async function elaborateIdea(
  label: string,
  essayContext: string,
): Promise<{ expansions: string[] }> {
  const r = await chatJSON<{ expansions?: string[] }>([
    { role: "system", content: PHILOSOPHY },
    {
      role: "user",
      content: `For the essay idea "${label}" (other ideas in the essay: ${
        essayContext || "n/a"
      }), return JSON:
{
  "expansions": string[]   // 2-4 DIRECTIONS to develop/improve this idea (questions or angles, NOT written content)
}
Use the writer's language. Do NOT write prose.`,
    },
  ]);
  return { expansions: r.expansions ?? [] };
}

/**
 * Reverse-outline reflection: compare the planned idea map against the actual
 * draft and surface the gaps both ways. The AI only identifies gaps — it never
 * writes prose to fill them; the writer decides what to do.
 */
export async function reflectPlanVsDraft(
  ideaLabels: string[],
  draft: string,
): Promise<PlanDraftGap> {
  if (ideaLabels.length === 0 && !draft.trim()) {
    return { missingFromDraft: [], notInMap: [] };
  }
  const r = await chatJSON<{ missingFromDraft?: string[]; notInMap?: string[] }>([
    { role: "system", content: PHILOSOPHY },
    {
      role: "user",
      content: `Compare the writer's IDEA MAP against their current DRAFT. Identify the
gaps so the writer can reflect — do NOT write any prose for them.

IDEA MAP (ideas they planned):
${ideaLabels.length ? ideaLabels.map((l) => `- ${l}`).join("\n") : "(empty)"}

DRAFT (what they've actually written so far):
"""
${draft || "(empty)"}
"""

Return JSON:
{
  "missingFromDraft": string[],  // ideas from the IDEA MAP the draft does NOT yet address; phrase each as the idea itself
  "notInMap": string[]           // substantive points the DRAFT makes that are NOT in the idea map; short phrases
}
Use the writer's own language. Be conservative — only list real, clear gaps.`,
    },
  ]);
  return {
    missingFromDraft: r.missingFromDraft ?? [],
    notInMap: r.notInMap ?? [],
  };
}

/**
 * Compare every bubble against the draft to set its sync status. Returns the ids
 * the draft covers (→ synced) and substantive draft points no bubble represents
 * (→ new draftOnly bubbles). The AI only classifies; it writes no prose.
 */
export async function syncCheck(
  nodes: { id: string; label: string }[],
  draft: string,
): Promise<SyncResult> {
  if (nodes.length === 0 && !draft.trim()) return { syncedIds: [], draftOnly: [] };
  const r = await chatJSON<{ syncedIds?: string[]; draftOnly?: string[] }>([
    { role: "system", content: PHILOSOPHY },
    {
      role: "user",
      content: `Compare these idea-map bubbles against the DRAFT and report their sync state.

BUBBLES (id: idea):
${nodes.length ? nodes.map((n) => `${n.id}: ${n.label}`).join("\n") : "(none)"}

DRAFT:
"""
${draft || "(empty)"}
"""

Return JSON:
{
  "syncedIds": string[],  // ids of bubbles whose idea the DRAFT clearly addresses
  "draftOnly": string[]   // substantive points the DRAFT makes that NO bubble represents (short phrases)
}
Be conservative: mark a bubble synced only if the draft clearly covers its idea.`,
    },
  ]);
  return { syncedIds: r.syncedIds ?? [], draftOnly: r.draftOnly ?? [] };
}

/**
 * Mindmap → Draft, step 1: decide WHERE a bubble belongs in the draft and
 * whether it's developed enough to insert. The AI only locates and judges — it
 * writes no prose.
 */
export async function locateInDraft(
  idea: { label: string; expansions: string[] },
  draft: string,
): Promise<DraftLocation> {
  if (!draft.trim()) return { anchor: "", enough: true };
  const r = await chatJSON<{ anchor?: string; enough?: boolean }>([
    { role: "system", content: PHILOSOPHY },
    {
      role: "user",
      content: `A writer wants to insert one idea into their draft. Decide WHERE it best fits and whether it is developed enough to insert.

IDEA: "${idea.label}"
${idea.expansions.length ? `Detail/directions: ${idea.expansions.join("; ")}` : ""}

DRAFT:
"""
${draft}
"""

Return JSON:
{
  "anchor": string,   // copy a SHORT EXACT substring (5-12 words) from the draft, AFTER which the idea should be inserted. Use "" to insert at the very end.
  "enough": boolean   // true if the idea is specific enough to write a concrete sentence; false if too vague/underdeveloped
}
Do NOT write the sentence. Only locate and judge.`,
    },
  ]);
  return { anchor: r.anchor ?? "", enough: r.enough ?? true };
}

/**
 * Mindmap → Draft, step 2 (minimal-edit mode only): fit the writer's idea into
 * the draft with ONLY small grammatical adjustments. The AI may not invent
 * substantive content or rephrase meaning — the writer's words stay theirs.
 */
export async function fitSentence(
  label: string,
  before: string,
  after: string,
): Promise<string> {
  const r = await chatJSON<{ sentence?: string }>([
    { role: "system", content: PHILOSOPHY },
    {
      role: "user",
      content: `Insert the writer's idea into their draft with only MINIMAL grammatical adjustment (tense, a connecting word, capitalization) so it fits the surrounding text. You may NOT invent new substantive content or rephrase the idea's meaning — keep the writer's own words.

IDEA (the writer's words): "${label}"
TEXT BEFORE: "...${before}"
TEXT AFTER: "${after}..."

Return JSON: { "sentence": string }   // the idea, minimally adjusted to fit. Keep it as close to verbatim as possible.`,
    },
  ]);
  return r.sentence ?? label;
}
