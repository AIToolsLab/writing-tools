/**
 * The runtime engine, used for ONE thing: translating the writer's own content
 * for the read-only view overlay. Interface copy never comes through here — that
 * is static i18n (see ./ui-strings.ts), which costs nothing and is instant.
 *
 * It sits behind `TranslationEngine` so the provider can be swapped without
 * touching feature code. There is one implementation: the OpenAI proxy the rest
 * of the app already talks to.
 */

import { postChat } from "./api";
import { languageLabel } from "./language";

export interface TranslationEngine {
  /** Translate one piece of writer content into `targetLang`. */
  translate(text: string, targetLang: string): Promise<string>;
}

export class TranslationError extends Error {}

// ---------------------------------------------------------------------------
// Do-not-translate regions
// ---------------------------------------------------------------------------

/**
 * Drafts contain code. Sending a fenced block, an inline span, a URL or an email
 * through a translator comes back as prose and silently destroys it, so those
 * regions are lifted out, the rest is translated, and they are put back verbatim.
 */
const PROTECTED_REGION =
  /```[\s\S]*?```|`[^`\n]+`|\bhttps?:\/\/[^\s<>"')]+|\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;

/**
 * A marker that survives translation. Digits inside brackets are left alone;
 * anything more exotic (private-use codepoints, HTML comments) gets stripped or
 * re-spaced by the model.
 */
function marker(index: number): string {
  return `[[[${index}]]]`;
}

export interface ProtectedText {
  /** The text with every protected region replaced by a marker. */
  masked: string;
  /** The removed regions, in marker order. */
  regions: string[];
}

export function maskProtectedRegions(text: string): ProtectedText {
  const regions: string[] = [];
  const masked = text.replace(PROTECTED_REGION, (match) => {
    regions.push(match);
    return marker(regions.length - 1);
  });
  return { masked, regions };
}

/**
 * Put the protected regions back. If the model dropped or mangled a marker the
 * result would splice code into the wrong place, so this reports failure and the
 * caller keeps the untranslated original — unreadable beats corrupted.
 */
export function restoreProtectedRegions(
  translated: string,
  regions: string[],
): string | undefined {
  let result = translated;
  for (let index = 0; index < regions.length; index += 1) {
    const token = marker(index);
    if (!result.includes(token)) return undefined;
    result = result.replace(token, () => regions[index]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Translate writer content through the OpenAI proxy, with code protected. */
export function openAiEngine(): TranslationEngine {
  return {
    async translate(text, targetLang) {
      const { masked, regions } = maskProtectedRegions(text);
      // Nothing but protected content: there is nothing to send.
      if (masked.replace(/\[\[\[\d+\]\]\]/g, "").trim().length === 0) return text;

      const raw = await postChat([
        {
          role: "system",
          content: [
            `You are a professional translator. Translate the user's message into ${languageLabel(targetLang)}.`,
            `Text already in ${languageLabel(targetLang)} must be returned unchanged.`,
            "Preserve meaning, tone, and line breaks.",
            "Markers like [[[0]]] are placeholders: copy them through exactly, never translate or reorder them.",
            'Reply with JSON: {"translation": "..."}.',
          ].join(" "),
        },
        { role: "user", content: masked },
      ]);

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new TranslationError("The model returned a response that was not valid JSON.");
      }
      const translation = (parsed as { translation?: unknown })?.translation;
      if (typeof translation !== "string") {
        throw new TranslationError("The model response was missing a 'translation' field.");
      }

      if (regions.length === 0) return translation;
      return restoreProtectedRegions(translation, regions) ?? text;
    },
  };
}
