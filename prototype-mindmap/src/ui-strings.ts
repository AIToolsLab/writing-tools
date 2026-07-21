/// <reference types="vite/client" />

/**
 * Interface copy: buttons, labels, hints, menus.
 *
 * This is the free, instant half of the translation story. Interface copy is a
 * finite set that is known before release, so it is answered from a checked-in
 * JSON file and NEVER from the runtime engine — changing the write or the view
 * language re-skins the page without a single request.
 *
 * Strings are keyed by their English source rather than by an invented id. The
 * app renders hundreds of literals, so a key-per-literal scheme would mean
 * touching every call site; keying by the source keeps one lookup and one file
 * per language. A string with no entry simply renders in English, so a partial
 * dictionary degrades in coverage, never in correctness.
 *
 * See ./i18n/README.md for how a dictionary is produced.
 */

const DICTIONARIES = import.meta.glob<Record<string, string>>("./i18n/*.json", {
  eager: true,
  import: "default",
});

/** code -> { english source: translation } */
const BY_LANGUAGE = new Map<string, Record<string, string>>(
  Object.entries(DICTIONARIES).flatMap(([path, entries]) => {
    const code = /\.\/i18n\/([\w-]+)\.json$/.exec(path)?.[1];
    return code && entries ? [[code, entries] as [string, Record<string, string>]] : [];
  }),
);

/** Languages that have a checked-in dictionary. */
export function translatedLanguages(): string[] {
  return [...BY_LANGUAGE.keys()].sort();
}

/**
 * The interface string for `target`, or undefined when this copy has no entry
 * yet — callers render the English source in that case.
 *
 * Interface copy is authored in English, so English needs no dictionary.
 */
export function uiString(source: string, target: string): string | undefined {
  if (target === "en") return undefined;
  return BY_LANGUAGE.get(target)?.[source.trim()];
}

/** Whether any interface copy at all is available for a language. */
export function hasUiDictionary(target: string): boolean {
  return target !== "en" && BY_LANGUAGE.has(target);
}

/**
 * Interface copy seen on screen that no dictionary covers yet. Recorded only in
 * dev builds, so `src/i18n/source.json` can be grown from what the app actually
 * renders instead of by hunting literals through the source.
 */
const missing = new Set<string>();

export function noteMissingUiString(source: string): void {
  if (import.meta.env.DEV) missing.add(source.trim());
}

export function missingUiStrings(): string[] {
  return [...missing].sort((a, b) => a.localeCompare(b));
}
