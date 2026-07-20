import { createContext, useContext } from "react";

/**
 * Page-wide access to the read-only translated view.
 *
 * The map and the Control Room render deep inside their own component trees, so
 * the translation lookup is shared through context rather than threaded as a
 * prop through every level.
 *
 * `translate` returns the original string when the session is being viewed in
 * the writing language, when the translation has not arrived yet, or when the
 * string has no translation — callers can always render its result directly.
 */
export interface TranslationView {
  /** True when the screen is showing a translation instead of the writer's words. */
  readOnly: boolean;
  translate: (text: string) => string;
}

const IDENTITY: TranslationView = {
  readOnly: false,
  translate: (text) => text,
};

export const TranslationContext = createContext<TranslationView>(IDENTITY);

export function useTranslation(): TranslationView {
  return useContext(TranslationContext);
}
