/**
 * Assistance Contracts (Stage 2).
 *
 * A contract is a versioned, immutable allowlist over what the AI may contribute
 * to a session: which response `kind`s it may emit and which `attribution`s are
 * permitted. It is the code-enforceable replacement for the old prompt-only
 * `helpMode` gradient.
 *
 * Three public levels, 0-2. Level 0 (non-directive) is the default for every new
 * session. The contract varies ONLY what the AI may contribute; the floor
 * (mirror validation, verbatim + map-write authorization, user confirmation,
 * provenance) is fixed at every level and enforced elsewhere in code.
 *
 * Study framing: L0 vs L2 are the two conditions; L1 is a product/demo affordance.
 */

/** 0 = non-directive (default) → 2 = suggestive. */
export type ContractLevel = 0 | 1 | 2;

/**
 * The kind of a coach turn. `reflection`/`map_proposal` mirror or propose
 * structure; `options` juxtaposes the user's own verbatim spans; `suggestion`
 * originates AI content. `question`/`aside` carry no map content.
 */
export type ResponseKind =
  | "question"
  | "reflection"
  | "aside"
  | "map_proposal"
  | "options"
  | "suggestion";

/**
 * Where a turn's structural content came from. `asserted` = grounded in what the
 * user stated in their own words (passes assertion grounding). `inferred` = the
 * AI originated or inferred it (only permitted at L2, always AI-attributed).
 */
export type Attribution = "asserted" | "inferred";

export interface Contract {
  /** Versioned, immutable id, e.g. "grounded-options-v1". */
  id: string;
  level: ContractLevel;
  /** Short human label for dev/experimenter UI. */
  label: string;
  allowedKinds: ResponseKind[];
  allowedAttribution: Attribution[];
  /** L1: every `options` entry must be a verbatim span of user material. */
  optionsMustBeVerbatim: boolean;
  /** Fixed floor — the user always confirms before anything lands on the map. */
  mapWritePolicy: "user_confirmation_required";
  /** L0/L1 keep the map user-authored-only; L2 allows an AI-attributed lane. */
  provenancePolicy: "user_authored_only" | "ai_attributed_allowed";
  /** The persona + "what you may contribute" block injected into the prompt. */
  promptFragment: string;
}

const NON_DIRECTIVE_FRAGMENT = `\
You are a non-directive writing coach helping the user build a mind map of their own
thinking. Your job is to ask questions and reflect structure the user has already
ASSERTED — never to author ideas, name relationships, or decide what belongs where.
WHAT YOU MAY CONTRIBUTE (Level 0 — non-directive): only questions, brief asides, and
reflections / map proposals of structure the user asserted in their own words. Never
invent ideas, relationships, or concepts the user has not expressed. Never lead a
question with an embedded answer. If the user is stuck ("I'm not sure", "I don't know"):
ask a tighter, more concrete version they can point at — never move on.`;

const GROUNDED_OPTIONS_FRAGMENT = `\
You are a writing coach helping the user build a mind map of their own thinking. You may
direct their attention by juxtaposing their own words, but you may not originate ideas or
structure.
WHAT YOU MAY CONTRIBUTE (Level 1 — grounded options): everything in Level 0, PLUS you may
offer OPTIONS — but every option MUST be a VERBATIM span of the user's own material (their
exact words from the conversation). You select and juxtapose the user's own words to help
them choose; you never add wording, ideas, or relationships of your own, and you never
present an option as decided. If the user is stuck: ask a tighter version, or surface a few
of their own verbatim phrases as options for them to pick from.`;

const SUGGESTIVE_FRAGMENT = `\
You are a hands-on, directive writing partner helping the user build a mind map. Be
proactive: point out what you notice in their thinking, draft, and map — gaps, tensions,
overlaps, unclear spots, missing pieces, and possible connections — and propose concrete
ideas AND suggest how their ideas might connect, nest, or be organized.
WHAT YOU MAY CONTRIBUTE (Level 2 — suggestive): everything in Level 1, PLUS you may
ORIGINATE ideas and structure as SUGGESTIONS (inferred content). You do NOT need to lead
with a question or a mirror; give your recommendation directly, as a proposal the user can
accept or reject. TWO things still hold: (a) any AI-originated material is clearly
AI-ATTRIBUTED and never masquerades as the user's own words; (b) you never write, draft,
summarize, or reword the user's own sentences or prose for them — you offer ideas and
structure, never finished writing. If the user is stuck: offer a concrete idea or next step.`;

/** Immutable registry. Frozen so a contract can never be mutated at runtime. */
export const CONTRACTS: Readonly<Record<ContractLevel, Contract>> = Object.freeze({
  0: Object.freeze({
    id: "non-directive-v1",
    level: 0,
    label: "Non-directive",
    allowedKinds: ["question", "reflection", "aside", "map_proposal"],
    allowedAttribution: ["asserted"],
    optionsMustBeVerbatim: false,
    mapWritePolicy: "user_confirmation_required",
    provenancePolicy: "user_authored_only",
    promptFragment: NON_DIRECTIVE_FRAGMENT,
  }),
  1: Object.freeze({
    id: "grounded-options-v1",
    level: 1,
    label: "Grounded options",
    allowedKinds: ["question", "reflection", "aside", "map_proposal", "options"],
    allowedAttribution: ["asserted"],
    optionsMustBeVerbatim: true,
    mapWritePolicy: "user_confirmation_required",
    provenancePolicy: "user_authored_only",
    promptFragment: GROUNDED_OPTIONS_FRAGMENT,
  }),
  2: Object.freeze({
    id: "suggestive-v1",
    level: 2,
    label: "Suggestive",
    allowedKinds: ["question", "reflection", "aside", "map_proposal", "options", "suggestion"],
    allowedAttribution: ["asserted", "inferred"],
    optionsMustBeVerbatim: true,
    mapWritePolicy: "user_confirmation_required",
    provenancePolicy: "ai_attributed_allowed",
    promptFragment: SUGGESTIVE_FRAGMENT,
  }),
}) as Readonly<Record<ContractLevel, Contract>>;

/** Default for every new session: non-directive. */
export const DEFAULT_CONTRACT_LEVEL: ContractLevel = 0;

export function contractFor(level: ContractLevel): Contract {
  return CONTRACTS[level] ?? CONTRACTS[DEFAULT_CONTRACT_LEVEL];
}

export function isContractLevel(value: unknown): value is ContractLevel {
  return value === 0 || value === 1 || value === 2;
}
