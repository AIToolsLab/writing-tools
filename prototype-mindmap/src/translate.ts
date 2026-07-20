/**
 * Read-only translation of session content.
 *
 * Translations are a projection for readers who do not read the writing
 * language. They are never written back into the draft, never harvested into
 * the map, and never fed to the assistant as the writer's wording — see
 * ./language.ts for the source-of-truth rules.
 */

import { postChat } from "./api";
import { languageLabel } from "./language";

/**
 * Keep a single request bounded; long sessions are split across calls.
 *
 * Sized down from the original 40/6000 after whole-page translation started
 * producing truncated responses: translated output is often longer than its
 * input, and an oversized batch runs into the completion limit.
 */
const MAX_ITEMS_PER_BATCH = 20;
const MAX_CHARS_PER_BATCH = 2500;

/**
 * How many batches may be in flight at once. Unbounded parallelism let a whole
 * page fire dozens of simultaneous requests, and the backend answered some of
 * them with empty bodies.
 */
const MAX_CONCURRENT_BATCHES = 4;

/**
 * Module-wide, not per call. Two callers translate a page at once (the DOM pass
 * and the per-string lookup); a per-call pool let each open its own four
 * connections, so the real number in flight was a multiple of the limit — which
 * is what drew the empty bodies.
 */
let inFlight = 0;
const waitingForSlot: Array<() => void> = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  while (inFlight >= MAX_CONCURRENT_BATCHES) {
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

export class TranslationError extends Error {}

/**
 * Split indices into batches small enough to translate in one call. A single
 * item longer than the char budget still gets its own batch rather than being
 * dropped or truncated.
 */
function batchIndices(texts: string[], indices: number[]): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  for (const index of indices) {
    const length = texts[index].length;
    const wouldOverflow =
      current.length >= MAX_ITEMS_PER_BATCH ||
      (current.length > 0 && chars + length > MAX_CHARS_PER_BATCH);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(index);
    chars += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function parseTranslations(raw: string, expected: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TranslationError("The model returned a response that was not valid JSON.");
  }
  const translations = (parsed as { translations?: unknown })?.translations;
  if (!Array.isArray(translations)) {
    throw new TranslationError("The model response was missing a 'translations' array.");
  }
  if (translations.length !== expected) {
    // Misaligned output would attribute one card's text to another, so fail
    // loudly rather than render a translation against the wrong source.
    throw new TranslationError(
      `The model returned ${translations.length} translations for ${expected} items.`,
    );
  }
  return translations.map((item) => (typeof item === "string" ? item : String(item ?? "")));
}

async function translateBatch(
  segments: string[],
  target: string,
): Promise<string[]> {
  const targetName = languageLabel(target);
  const system = [
    `You are a professional translator. Translate each item into ${targetName}.`,
    // One page mixes interface copy (authored in English) with the writer's own
    // text, so the source language is decided per item rather than declared.
    `Items already written in ${targetName} must be returned unchanged.`,
    "Preserve meaning, tone, and line breaks. Do not add, remove, summarize, explain, or merge items.",
    `Reply with JSON: {"translations": [...]} containing exactly ${segments.length} strings, in the same order as the input.`,
  ].join(" ");
  const user = JSON.stringify({ items: segments });

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  let raw: string;
  try {
    raw = await postChat(messages);
  } catch (error) {
    // Transport failures are usually transient (a dropped/empty body under
    // load), so retry once before failing the whole page.
    try {
      raw = await postChat(messages);
    } catch {
      // The raw failure is a bare "Unexpected end of JSON input"; name it.
      const detail = error instanceof Error ? error.message : String(error);
      throw new TranslationError(`Could not reach the translation service (${detail}).`);
    }
  }
  return parseTranslations(raw, segments.length);
}

/**
 * Translate a list of strings, preserving order and length.
 *
 * Blank entries are passed through untouched so the caller can translate a
 * whole screen's worth of text — draft, cards, chat, recap — by index without
 * filtering first.
 */
export async function translateStrings(
  texts: string[],
  target: string,
  onPartial?: (entries: Array<[string, string]>) => void,
): Promise<string[]> {
  const result = [...texts];

  const translatable = texts
    .map((_text, index) => index)
    .filter((index) => texts[index].trim().length > 0);
  if (translatable.length === 0) return result;

  // Independent batches run concurrently and report as they land, all queued on
  // the module-wide slot limit so the open count is independent of caller count.
  const batches = batchIndices(texts, translatable);

  await Promise.all(
    batches.map((batch) =>
      withSlot(async () => {
        const translated = await translateBatch(
          batch.map((index) => texts[index]),
          target,
        );
        const entries: Array<[string, string]> = [];
        batch.forEach((index, position) => {
          result[index] = translated[position];
          entries.push([texts[index], translated[position]]);
        });
        onPartial?.(entries);
      }),
    ),
  );
  return result;
}
