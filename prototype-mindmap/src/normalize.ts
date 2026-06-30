/**
 * Text normalization and tokenization for grounding checks.
 *
 * The normalizer mirrors prototype-uist's `ownership.ts` so the two prototypes
 * agree on what "the same words" means. On top of it we add a light stemmer and
 * a stopword list, which the 3-check mirror validator needs to tell content
 * words apart from structural glue and to match word *variants*.
 *
 * The stemmer is intentionally crude (suffix stripping). Real lemmatization
 * would be better; this is a swappable stub. It is good enough to treat
 * "organizing" and "organized" as the same root for a prototype.
 */

const SMART_QUOTES_RE = /[‘’‚‛]/g;
const SMART_DOUBLE_QUOTES_RE = /[“”„‟]/g;
const NON_ALPHANUMERIC_RE = /[^\p{L}\p{N}\s]/gu;
const MULTISPACE_RE = /\s+/g;

/** Same normalization contract as ownership.ts: quotes, punctuation, case, spacing. */
export function normalize(text: string): string {
  return text
    .replace(SMART_QUOTES_RE, "'")
    .replace(SMART_DOUBLE_QUOTES_RE, '"')
    .replace(NON_ALPHANUMERIC_RE, " ")
    .replace(MULTISPACE_RE, " ")
    .trim()
    .toLowerCase();
}

export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ").filter(Boolean) : [];
}

/**
 * Function words and common conversational glue. A word classified as a
 * stopword is "structural glue": the AI may use it freely without it counting
 * against the unsupported-word budget, because it carries no idea.
 */
export const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "as", "of", "to",
  "in", "on", "at", "by", "for", "with", "from", "into", "about", "is", "are",
  "was", "were", "be", "been", "being", "am", "do", "does", "did", "have", "has",
  "had", "it", "its", "this", "that", "these", "those", "i", "you", "your",
  "they", "them", "their", "we", "us", "our", "he", "she", "him", "her", "his",
  "my", "me", "what", "which", "who", "how", "when", "where", "there", "here",
  "like", "just", "really", "kind", "sort", "feel", "feels", "felt", "think",
  "thing", "things", "would", "could", "should", "can", "will", "also", "very",
  "more", "some", "any", "not", "no", "yes", "up", "out", "down", "over", "say",
  "said", "sounds", "seem", "seems",
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/**
 * Light suffix-stripping stemmer. Swappable stub for a real lemmatizer.
 *
 * Two phases so variants converge consistently:
 *   1. strip a single inflectional suffix (longest first)
 *   2. always strip a trailing "e"
 * This makes node/nodes -> "nod" and organize/organizing -> "organiz" agree,
 * which the one-rule-then-break approach could not.
 */
export function stem(token: string): string {
  let t = token;
  const rules: Array<[RegExp, string]> = [
    [/ies$/, "y"],
    [/ied$/, "y"],
    [/ing$/, ""],
    [/edly$/, ""],
    [/ed$/, ""],
    [/es$/, ""],
    [/ly$/, ""],
    [/s$/, ""],
  ];
  for (const [re, repl] of rules) {
    if (re.test(t) && t.replace(re, repl).length >= 3) {
      t = t.replace(re, repl);
      break;
    }
  }
  if (t.length > 3 && t.endsWith("e")) {
    t = t.slice(0, -1);
  }
  return t;
}

/** Content tokens = non-stopword tokens. These carry the ideas. */
export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !isStopword(t));
}

/**
 * Split a block of input (a long voice chunk or a pasted draft) into
 * sentence-level units. Each unit becomes its own Source Bank entry, so:
 *   - grounding stays meaningful (a relationship must live in ONE sentence,
 *     not be assembled across a whole rant or document);
 *   - readiness density reflects distinct ideas, not turn count;
 *   - each unit is an addressable region the UI can highlight/anchor to.
 * Splits on sentence terminators and newlines. A block with no terminator
 * stays a single unit.
 */
export function segment(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A set of stems for fast membership testing. */
export function stemSet(texts: string[]): Set<string> {
  const set = new Set<string>();
  for (const text of texts) {
    for (const tok of tokenize(text)) {
      set.add(stem(tok));
    }
  }
  return set;
}
