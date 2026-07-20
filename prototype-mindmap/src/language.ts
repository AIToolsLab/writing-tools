/**
 * Writing language and the read-only translated view.
 *
 * The writer's own words are the single source of truth. A translation is a
 * *projection* of that source for readers/teachers who do not read the writing
 * language — it is never written back, never harvested into the map, and never
 * sent to the assistant as if it were the writer's wording. Writing can only
 * continue on the original draft language.
 */

// Curated set of mainstream languages (BCP-47 primary subtags). Names are
// rendered by the browser's Intl.DisplayNames rather than hand-maintained here.
export const LANGUAGE_CODES = [
  "en", "zh", "es", "hi", "ar", "pt", "ru", "ja", "de", "fr",
  "ko", "it", "tr", "vi", "pl", "uk", "nl", "id", "th", "fa",
  "he", "sv", "ro", "el", "cs", "da", "fi", "nb", "hu", "bn",
  "ta", "ur", "ms", "fil",
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export interface LanguageOption {
  code: string;
  /** Name in the user's current UI language, e.g. "Chinese". */
  label: string;
  /** Name in the language itself (autonym), e.g. "中文". */
  nativeLabel: string;
}

/**
 * Which language the session is being viewed in.
 *
 * `viewLanguage === null` means "the original draft" — editable, the source of
 * truth. Any other value is a read-only translation.
 */
export interface LanguageState {
  draftLanguage: string;
  viewLanguage: string | null;
  /** False while `draftLanguage` is only the browser's guess; a guess is never
   *  enforced against input. Set once the first message or the picker settles it. */
  settled: boolean;
}

/**
 * Language names are always rendered in English, not in the browser's UI
 * locale. The rest of this interface is in English, so following the browser
 * would leave a Chinese reader with "Show in 葡萄牙语" next to "Clear chat".
 * Each option still carries its autonym, which is what a speaker actually
 * recognizes.
 */
const LABEL_LOCALE = "en";

function uiLocale(): string {
  return typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en";
}

function displayName(code: string, inLocale: string): string {
  try {
    const names = new Intl.DisplayNames([inLocale], { type: "language" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Human-readable English name of a language code. */
export function languageLabel(code: string): string {
  return displayName(code, LABEL_LOCALE);
}

/**
 * Build the picker list, labelled for the given UI locale and sorted by that
 * label. Each option also carries the language's autonym so writers can find
 * their own language even when the UI is in another language.
 */
export function languageOptions(locale: string = LABEL_LOCALE): LanguageOption[] {
  return LANGUAGE_CODES.map((code) => ({
    code,
    label: displayName(code, locale),
    nativeLabel: displayName(code, code),
  })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** Best-guess writing language from the browser, used for a fresh session. */
export function defaultDraftLanguage(): string {
  const primary = uiLocale().split("-")[0];
  return (LANGUAGE_CODES as readonly string[]).includes(primary) ? primary : "en";
}

/**
 * The writing system each language is normally written in. Only languages whose
 * script is distinctive are listed: Latin-script languages share one script and
 * cannot be told apart this way.
 */
const SCRIPT_BY_LANGUAGE: Record<string, RegExp> = {
  zh: /\p{Script=Han}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
  ur: /\p{Script=Arabic}/u,
  he: /\p{Script=Hebrew}/u,
  el: /\p{Script=Greek}/u,
  hi: /\p{Script=Devanagari}/u,
  bn: /\p{Script=Bengali}/u,
  ta: /\p{Script=Tamil}/u,
  th: /\p{Script=Thai}/u,
};

const LATIN = /\p{Script=Latin}/u;
const LATIN_GLOBAL = /\p{Script=Latin}/gu;

/**
 * Whether some text plausibly belongs to the writing language.
 *
 * A script check, not language identification: it reliably catches typing Latin
 * text while writing in Chinese (and the reverse), which is the mistake worth
 * blocking. It cannot separate English from French, so Latin-script languages
 * accept any Latin text rather than guessing and rejecting valid input.
 */
export function matchesWritingLanguage(text: string, code: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const expected = SCRIPT_BY_LANGUAGE[code];
  if (expected) return expected.test(trimmed);

  // Latin-script language: reject only text that is clearly another script.
  for (const [language, script] of Object.entries(SCRIPT_BY_LANGUAGE)) {
    if (language === code) continue;
    if (script.test(trimmed) && !LATIN.test(trimmed)) return false;
  }
  return true;
}

/** Languages per script, most likely first. Kana are split from Han because
 *  they distinguish Japanese from Chinese; Latin is handled separately below. */
const SCRIPT_CANDIDATES: Array<{ script: RegExp; languages: string[] }> = [
  { script: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu, languages: ["ja"] },
  { script: /\p{Script=Han}/gu, languages: ["zh", "ja"] },
  { script: /\p{Script=Hangul}/gu, languages: ["ko"] },
  { script: /\p{Script=Cyrillic}/gu, languages: ["ru", "uk"] },
  { script: /\p{Script=Arabic}/gu, languages: ["ar", "fa", "ur"] },
  { script: /\p{Script=Hebrew}/gu, languages: ["he"] },
  { script: /\p{Script=Greek}/gu, languages: ["el"] },
  { script: /\p{Script=Devanagari}/gu, languages: ["hi"] },
  { script: /\p{Script=Bengali}/gu, languages: ["bn"] },
  { script: /\p{Script=Tamil}/gu, languages: ["ta"] },
  { script: /\p{Script=Thai}/gu, languages: ["th"] },
];

function countMatches(text: string, script: RegExp): number {
  script.lastIndex = 0; // these patterns are global and module-level
  let count = 0;
  while (script.exec(text) !== null) count += 1;
  return count;
}

/**
 * Read the writing language off the writer's text by script.
 *
 * Decisive where a script is (Chinese, Japanese, Korean, Greek…). Where one
 * script serves several languages, `preferred` (the browser guess) picks among
 * them, since the text cannot separate e.g. English from French. The dominant
 * script wins, so a quoted foreign term does not decide the message.
 */
export function detectWritingLanguage(
  text: string,
  preferred: string = defaultDraftLanguage(),
): string {
  const trimmed = text.trim();
  if (!trimmed) return preferred;

  let best: string[] | null = null;
  let bestCount = 0;
  for (const { script, languages } of SCRIPT_CANDIDATES) {
    const count = countMatches(trimmed, script);
    // Any kana settles Japanese; a count vote would read its Han majority as Chinese.
    if (count > 0 && languages[0] === "ja") return "ja";
    if (count > bestCount) {
      best = languages;
      bestCount = count;
    }
  }

  const latinCount = countMatches(trimmed, LATIN_GLOBAL);
  if (latinCount > bestCount) {
    // Latin: keep the guess if it is itself Latin-script, else fall back to English.
    return SCRIPT_BY_LANGUAGE[preferred] ? "en" : preferred;
  }
  if (!best) return preferred;

  // Honour the guess when it is one of this script's languages (uk over ru).
  return best.includes(preferred) ? preferred : best[0];
}

export function initialLanguageState(): LanguageState {
  // Only a guess until the first message arrives to confirm or correct it.
  return { draftLanguage: defaultDraftLanguage(), viewLanguage: null, settled: false };
}

/**
 * Fix the writing language from the first message, once. Later messages never
 * move it: the map and draft are already built from that language's words, so
 * quoting another one must not redefine the session.
 */
export function settleDraftLanguage(
  state: LanguageState,
  text: string,
): LanguageState {
  if (state.settled) return state;
  return setDraftLanguage(state, detectWritingLanguage(text, state.draftLanguage));
}

/** The language actually on screen right now. */
export function effectiveLanguage(state: LanguageState): string {
  return state.viewLanguage ?? state.draftLanguage;
}

/**
 * True when the screen is showing a translation rather than the writer's own
 * words. Everything that writes — the composer, card edits, map proposals — must
 * be disabled while this holds.
 */
export function isReadOnlyView(state: LanguageState): boolean {
  return effectiveLanguage(state) !== state.draftLanguage;
}

/**
 * Select a language to view. Choosing the draft language returns to the
 * original; `null` does the same and is what "back to writing" uses.
 */
export function selectViewLanguage(
  state: LanguageState,
  code: string | null,
): LanguageState {
  return {
    ...state,
    viewLanguage: code === null || code === state.draftLanguage ? null : code,
  };
}

/**
 * Change the writing language, and settle it. Never locked: detection can only
 * narrow a Latin-script language to the browser guess, so a writer drafting
 * French in an English browser must be able to correct it later.
 */
export function setDraftLanguage(
  state: LanguageState,
  code: string,
): LanguageState {
  // Viewing the newly chosen language is now viewing the original.
  return {
    draftLanguage: code,
    viewLanguage: state.viewLanguage === code ? null : state.viewLanguage,
    settled: true,
  };
}
