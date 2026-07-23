/// <reference types="vite/client" />

/**
 * Interface copy: buttons, labels, hints, menus.
 *
 * Interface copy is finite and known before release, so it is answered from a
 * checked-in JSON file and never from a runtime translation engine. Changing
 * the UI locale re-skins application chrome without a provider request.
 *
 * Strings are keyed by their English source rather than an invented id.
 * Callers explicitly opt fixed React copy into `uiString`; user/model-authored
 * text is never passed here. A missing entry renders in English, so a partial
 * dictionary degrades in coverage rather than correctness.
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

/**
 * The same, keyed by the lowercased source.
 *
 * Case is an English styling choice, not a difference in meaning: the recap
 * says "cards" where the panel heading says "Cards", and CSS renders `Framing`
 * as FRAMING. Folding case keeps one entry per phrase instead of one per
 * casing, and stops copy from going untranslated because the key was written
 * the way the screen shows it.
 */
const FOLDED_BY_LANGUAGE = new Map(
  [...BY_LANGUAGE].map(([code, entries]) => [
    code,
    Object.fromEntries(Object.entries(entries).map(([source, text]) => [source.toLowerCase(), text])),
  ]),
);

/** Languages that have a checked-in dictionary. */
export function translatedLanguages(): string[] {
  return [...BY_LANGUAGE.keys()].filter((code) => code !== "source").sort();
}

/**
 * The interface string for `target`, or undefined when this copy has no entry
 * yet — callers render the English source in that case.
 *
 * Interface copy is authored in English, so English needs no dictionary.
 */
export function uiString(source: string, target: string): string | undefined {
  if (target === "en") return undefined;
  const key = source.trim();
  return BY_LANGUAGE.get(target)?.[key] ?? FOLDED_BY_LANGUAGE.get(target)?.[key.toLowerCase()];
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
