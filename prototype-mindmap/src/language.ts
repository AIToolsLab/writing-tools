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

export function initialLanguageState(): LanguageState {
  return { draftLanguage: defaultDraftLanguage(), viewLanguage: null };
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
 * Change the writing language.
 *
 * Deliberately never locked. The initial value is only a guess from the
 * browser's UI locale, which is frequently wrong — someone with a Chinese
 * browser may well be writing in English. Locking a wrong guess once the
 * session has content would leave the writer permanently mislabelled with no
 * way out, which is far worse than allowing a late correction.
 */
export function setDraftLanguage(
  state: LanguageState,
  code: string,
): LanguageState {
  // Viewing the newly chosen language is now viewing the original.
  return {
    draftLanguage: code,
    viewLanguage: state.viewLanguage === code ? null : state.viewLanguage,
  };
}
