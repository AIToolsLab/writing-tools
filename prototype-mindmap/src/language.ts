/**
 * The two languages a session has.
 *
 * WRITE language — what the whole interface renders in. It is a display setting
 * the writer owns and changes whenever they like. It says nothing about what may
 * be typed: input is accepted in any language, always.
 *
 * VIEW language — a read-only projection for a reader or teacher who does not
 * read what the writer wrote. While it differs from the write language the
 * screen is not the writer's own words, so nothing may be composed, edited, or
 * sent: a translation is never written back, never harvested into the map, and
 * never handed to the assistant as the writer's wording.
 */

// Curated set of mainstream languages (BCP-47 primary subtags). Names are
// rendered by the browser's Intl.DisplayNames rather than hand-maintained here.
export const LANGUAGE_CODES = [
  "en", "zh", "es", "hi", "ar", "pt", "ru", "ja", "de", "fr",
  "ko", "it", "tr", "vi", "pl", "uk", "nl", "id", "th", "fa",
  "he", "sv", "ro", "el", "cs", "da", "fi", "nb", "hu", "bn",
  "ta", "ur", "ms", "fil",
] as const;

export interface LanguageOption {
  code: string;
  /** Name in the picker's locale, e.g. "Chinese". */
  label: string;
  /** Name in the language itself (autonym), e.g. "中文". */
  nativeLabel: string;
}

export interface LanguageState {
  /** What the interface renders in. Never constrains input. */
  writeLanguage: string;
  /** A reader's language, or null for the writer's own view. */
  viewLanguage: string | null;
  /**
   * True once the writer has picked a language. Until then `writeLanguage` is
   * only the browser's guess, which is re-made on each load rather than stored.
   */
  chosen: boolean;
}

/**
 * Language names are always rendered in English, not in the browser's UI locale.
 * The rest of this interface is in English, so following the browser would leave
 * a Chinese reader with "Show in 葡萄牙语" next to "Clear chat". Each option
 * still carries its autonym, which is what a speaker actually recognizes.
 */
const LABEL_LOCALE = "en";

function displayName(code: string, inLocale: string): string {
  try {
    return new Intl.DisplayNames([inLocale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Human-readable English name of a language code. */
export function languageLabel(code: string): string {
  return displayName(code, LABEL_LOCALE);
}

/**
 * Build the picker list, labelled for the given locale and sorted by that label.
 * Each option also carries the language's autonym so writers can find their own
 * language even when the interface is in another one.
 */
export function languageOptions(locale: string = LABEL_LOCALE): LanguageOption[] {
  return LANGUAGE_CODES.map((code) => ({
    code,
    label: displayName(code, locale),
    nativeLabel: displayName(code, code),
  })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

/** The browser's language, when we support it — the opening guess only. */
export function defaultUiLanguage(): string {
  const primary = (typeof navigator !== "undefined" && navigator.language
    ? navigator.language
    : "en"
  ).split("-")[0];
  return (LANGUAGE_CODES as readonly string[]).includes(primary) ? primary : "en";
}

export function initialLanguageState(): LanguageState {
  return { writeLanguage: defaultUiLanguage(), viewLanguage: null, chosen: false };
}

/** Restore a language the writer chose in an earlier session. */
export function restoreLanguageState(code: string | undefined): LanguageState {
  const fresh = initialLanguageState();
  return code ? setWriteLanguage(fresh, code) : fresh;
}

/** The language actually on screen right now. */
export function effectiveLanguage(state: LanguageState): string {
  return state.viewLanguage ?? state.writeLanguage;
}

/**
 * True when the screen shows a reader's translation rather than the writer's own
 * words. Everything that writes must be disabled while this holds.
 */
export function isReadOnlyView(state: LanguageState): boolean {
  return effectiveLanguage(state) !== state.writeLanguage;
}

/** Choose what the interface renders in. Always available to the writer. */
export function setWriteLanguage(state: LanguageState, code: string): LanguageState {
  return {
    writeLanguage: code,
    // Viewing the newly chosen language is now just viewing the interface.
    viewLanguage: state.viewLanguage === code ? null : state.viewLanguage,
    chosen: true,
  };
}

/**
 * Show a read-only translation. Choosing the write language returns to the
 * writer's own view, as does `null` — which is what "back to writing" uses.
 */
export function selectViewLanguage(state: LanguageState, code: string | null): LanguageState {
  return {
    ...state,
    viewLanguage: code === null || code === state.writeLanguage ? null : code,
  };
}
