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

  let raw: string;
  try {
    raw = await postChat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
  } catch (error) {
    // A truncated or empty body surfaces here as a bare "Unexpected end of JSON
    // input", which says nothing about what actually failed.
    const detail = error instanceof Error ? error.message : String(error);
    throw new TranslationError(`Could not reach the translation service (${detail}).`);
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

  // Batches are independent, so several run at once — a long session is
  // otherwise as slow as the sum of its parts — but only a few at a time, and
  // each reports as it lands so text appears progressively.
  const batches = batchIndices(texts, translatable);
  let next = 0;

  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
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
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) }, worker),
  );
  return result;
}
