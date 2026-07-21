/**
 * Translation of the writer's own content for the read-only view overlay.
 *
 * This is the paid half. It runs only while the view language differs from the
 * write language, and only over content the writer produced — draft, cards, chat.
 * Interface copy never comes through here; that is a static dictionary lookup
 * (see ./ui-strings.ts), which costs nothing.
 *
 * Translations are never written back into stored content: the document is only
 * ever held in the write language (see ./language.ts).
 */

import type { TranslationEngine } from "./translation-engine";
import {
  lookupTranslation,
  rememberTranslations,
} from "./translation-memory";

export { TranslationError } from "./translation-engine";

/**
 * How many pieces may be translated at once. Unbounded parallelism let a whole
 * page fire dozens of simultaneous requests, and the proxy answered some of them
 * with empty bodies.
 */
const MAX_CONCURRENT = 4;

let inFlight = 0;
const waitingForSlot: Array<() => void> = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  while (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  }
  inFlight += 1;
  try {
    return await run();
  } finally {
    inFlight -= 1;
    waitingForSlot.shift()?.();
  }
}

/**
 * Translate writer content, preserving order and length.
 *
 * Blank entries pass through untouched so a caller can hand over a whole
 * screen's worth by index without filtering first. Anything already translated
 * on this browser is answered from memory, so toggling the view back and forth
 * costs nothing after the first pass.
 */
export async function translateContent(
  texts: string[],
  target: string,
  engine: TranslationEngine,
  onPartial?: (entries: Array<[string, string]>) => void,
): Promise<string[]> {
  const result = [...texts];

  const unknown: number[] = [];
  const known: Array<[string, string]> = [];
  texts.forEach((text, index) => {
    if (text.trim().length === 0) return;
    const hit = lookupTranslation(text, target);
    if (hit === undefined) {
      unknown.push(index);
      return;
    }
    result[index] = hit;
    known.push([text, hit]);
  });

  // Report what we already had before opening any connection.
  if (known.length > 0) onPartial?.(known);
  if (unknown.length === 0) return result;

  await Promise.all(
    unknown.map((index) =>
      withSlot(async () => {
        const translated = await engine.translate(texts[index], target);
        result[index] = translated;
        rememberTranslations([[texts[index], translated]], target);
        onPartial?.([[texts[index], translated]]);
      }),
    ),
  );
  return result;
}
