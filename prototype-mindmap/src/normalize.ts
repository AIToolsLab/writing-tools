/**
 * Language-neutral normalization plus narrow English and Chinese grounding
 * profiles. These functions compare text only; stored authored text is never
 * rewritten.
 */

import { CJK_SCRIPT_RE } from "./unicode-scripts";

const segmenters = new Map<string, Intl.Segmenter>();
const graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

interface TokenRecord {
  text: string;
  rawStart: number;
  rawEnd: number;
}

export interface PhraseRange {
  /** UTF-16 offsets into the unchanged original string. */
  start: number;
  end: number;
}

/** Fold compatibility-width forms and equivalent quotation marks for matching. */
export function foldWidthAndQuotes(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u300C\u300D\u300E\u300F]/g, "\"");
}

function wordSegmenter(locale: "en" | "zh"): Intl.Segmenter {
  const cached = segmenters.get(locale);
  if (cached) return cached;
  const created = new Intl.Segmenter(locale, { granularity: "word" });
  segmenters.set(locale, created);
  return created;
}

function foldedWithRawOffsets(text: string): { text: string; rawOffsets: Array<{ start: number; end: number }> } {
  let folded = "";
  const rawOffsets: Array<{ start: number; end: number }> = [];
  for (const grapheme of graphemeSegmenter.segment(text)) {
    const normalized = foldWidthAndQuotes(grapheme.segment).toLocaleLowerCase("und");
    folded += normalized;
    for (let index = 0; index < normalized.length; index++) {
      rawOffsets.push({ start: grapheme.index, end: grapheme.index + grapheme.segment.length });
    }
  }
  return { text: folded, rawOffsets };
}

function normalizedTokenRecords(text: string): TokenRecord[] {
  const folded = foldedWithRawOffsets(text);
  if (!folded.text) return [];
  const locale = CJK_SCRIPT_RE.test(folded.text) ? "zh" : "en";
  return Array.from(wordSegmenter(locale).segment(folded.text))
    .filter((part) => part.isWordLike)
    .flatMap((part) => Array.from(part.segment.matchAll(/[\p{L}\p{N}]+/gu)).map((match) => {
      const foldedStart = part.index + (match.index ?? 0);
      const foldedEnd = foldedStart + match[0].length;
      return {
        text: match[0],
        rawStart: folded.rawOffsets[foldedStart]?.start ?? 0,
        rawEnd: folded.rawOffsets[foldedEnd - 1]?.end ?? text.length,
      };
    }));
}

function normalizedWordTokens(text: string): string[] {
  return normalizedTokenRecords(text).map((token) => token.text);
}

/** Canonical comparison form: folded, segmented words separated by spaces. */
export function normalize(text: string): string {
  return normalizedWordTokens(text).join(" ");
}

export function tokenize(text: string): string[] {
  return normalizedWordTokens(text);
}

/**
 * Tests whether a normalized phrase occurs as a run of complete segmented
 * words. This prevents `under` matching `thunder` while supporting Chinese
 * text without whitespace and harmless punctuation-width differences.
 */
export function containsWholePhrase(haystack: string, phrase: string): boolean {
  return Boolean(findWholePhraseRange(haystack, phrase));
}

/** Locate a verified evidence phrase without accepting model-computed offsets. */
export function findWholePhraseRange(haystack: string, phrase: string): PhraseRange | undefined {
  const haystackTokens = normalizedTokenRecords(haystack);
  const phraseTokens = normalizedWordTokens(phrase);
  if (phraseTokens.length === 0 || phraseTokens.length > haystackTokens.length) return undefined;
  for (let start = 0; start <= haystackTokens.length - phraseTokens.length; start++) {
    if (!phraseTokens.every((token, offset) => haystackTokens[start + offset]?.text === token)) continue;
    return {
      start: haystackTokens[start]!.rawStart,
      end: haystackTokens[start + phraseTokens.length - 1]!.rawEnd,
    };
  }
  return undefined;
}

/**
 * English function words plus a closed class of Chinese particles/glue. This
 * list may permit grammar, never new substantive claims.
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
  "的", "了", "是", "就", "吗", "呢", "也", "和", "在", "着", "过", "呀", "吧", "啊",
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/**
 * Light English suffix stripping. Tokens in other scripts pass through
 * unchanged, so Chinese substantive terms still require exact token support.
 */
export function stem(token: string): string {
  if (!/^\p{Script=Latin}+$/u.test(token)) return token;
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
  for (const [rule, replacement] of rules) {
    if (rule.test(t) && t.replace(rule, replacement).length >= 3) {
      t = t.replace(rule, replacement);
      break;
    }
  }
  if (t.length > 3 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((token) => !isStopword(token));
}

/** Split authored input into addressable sentence-level Source Bank entries. */
export function segment(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|(?<=[。！？])|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function stemSet(texts: string[]): Set<string> {
  const set = new Set<string>();
  for (const text of texts) {
    for (const token of tokenize(text)) set.add(stem(token));
  }
  return set;
}
