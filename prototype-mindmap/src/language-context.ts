import { CJK_SCRIPT_RE } from "./unicode-scripts";

/**
 * Conversational language hints are deliberately separate from evidence and
 * grounding. They may help the coach choose a natural reply register, but never
 * alter, normalize, or validate the user's authored wording.
 */
export type LatestUserLanguagePattern = "single" | "mixed" | "unknown";

export interface LanguageContext {
  /** The interface display locale, never a response-language instruction. */
  uiLocale: string;
  /** Reserved for a future explicit coach-language preference control. */
  preferredCoachLanguage?: string;
  latestUserLanguagePattern: LatestUserLanguagePattern;
}

type ScriptFamily = "cjk" | "latin" | "arabic" | "cyrillic" | "hebrew" | "devanagari" | "greek" | "thai" | "armenian" | "georgian";

const LETTER = /\p{L}/u;
const SCRIPT_FAMILIES: ReadonlyArray<readonly [ScriptFamily, RegExp]> = [
  // Han commonly co-occurs with Kana, Hangul, or Bopomofo in one language.
  ["cjk", CJK_SCRIPT_RE],
  ["latin", /\p{Script=Latin}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["greek", /\p{Script=Greek}/u],
  ["thai", /\p{Script=Thai}/u],
  ["armenian", /\p{Script=Armenian}/u],
  ["georgian", /\p{Script=Georgian}/u],
];

/**
 * Returns only a coarse script-pattern hint. An unfamiliar letter script is
 * intentionally unknown rather than guessed; numbers and punctuation carry no
 * language signal. CJK-adjacent scripts share one family so normal Japanese and
 * Korean-with-Hanja turns are not mistaken for mixed-language turns.
 */
export function detectLatestUserLanguagePattern(text: string): LatestUserLanguagePattern {
  const families = new Set<ScriptFamily>();
  for (const character of text) {
    if (!LETTER.test(character)) continue;
    const family = SCRIPT_FAMILIES.find(([, expression]) => expression.test(character))?.[0];
    if (!family) return "unknown";
    families.add(family);
  }
  if (families.size === 0) return "unknown";
  return families.size === 1 ? "single" : "mixed";
}
