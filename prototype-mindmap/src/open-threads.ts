import { contentTokens, normalize } from "./normalize";
import type { SourceUtterance } from "./types";

export type ParkedThreadStatus = "parked" | "active" | "promoted" | "ignored" | "stale";

export interface ParkedThread {
  id: string;
  sourceTurnId: string;
  sourceUtteranceIds: string[];
  /** Exact user wording only. This is a memory anchor, not a summary. */
  text: string;
  status: ParkedThreadStatus;
  createdAt: number;
  updatedAt: number;
}

export interface OpenThreadContext {
  id: string;
  text: string;
  status: ParkedThreadStatus;
  sourceUtteranceIds: string[];
}

const MIN_CONTENT_TOKENS = 2;
const VOICE_BOUNDARY_RE =
  /\b(?:another thing|also|the next point|next point|and then|then|second thing|third thing|one thing|first thing)\b/gi;

function normalizedThreadText(text: string): string {
  return normalize(text).replace(/\s+/g, " ").trim();
}

function shortHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function hasEnoughContent(text: string): boolean {
  return contentTokens(text).length >= MIN_CONTENT_TOKENS;
}

function splitVoiceSpan(text: string): string[] {
  const matches = Array.from(text.matchAll(VOICE_BOUNDARY_RE));
  if (matches.length === 0) return [text.trim()].filter(Boolean);

  const starts = [0, ...matches.map((match) => match.index ?? 0).filter((index) => index > 0)];
  const spans: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = starts[i + 1] ?? text.length;
    const span = text.slice(start, end).trim();
    if (span) spans.push(span);
  }
  return spans;
}

export function deriveParkableSpans(units: SourceUtterance[]): Array<{ text: string; utteranceIds: string[] }> {
  const spans: Array<{ text: string; utteranceIds: string[] }> = [];
  for (const unit of units) {
    const pieces = splitVoiceSpan(unit.text);
    for (const piece of pieces) {
      if (!hasEnoughContent(piece)) continue;
      spans.push({ text: piece, utteranceIds: [unit.id] });
    }
  }
  return spans;
}

export function parkExploratoryTurn(
  existing: ParkedThread[],
  units: SourceUtterance[],
  now = Date.now(),
): ParkedThread[] {
  if (units.length === 0) return existing;
  const sourceTurnId = units[0].turnId ?? "";
  if (!sourceTurnId) return existing;

  const seen = new Set(existing.map((thread) => normalizedThreadText(thread.text)));
  const next = [...existing];
  const spans = deriveParkableSpans(units);
  spans.forEach((span, index) => {
    const normalized = normalizedThreadText(span.text);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    next.push({
      id: `pt_${sourceTurnId}_${index}_${shortHash(normalized)}`,
      sourceTurnId,
      sourceUtteranceIds: span.utteranceIds,
      text: span.text,
      status: "parked",
      createdAt: now,
      updatedAt: now,
    });
  });
  return next;
}

function tokenOverlapRatio(a: string, b: string): number {
  const aTokens = new Set(contentTokens(a).filter((token) => token.length > 2));
  const bTokens = new Set(contentTokens(b).filter((token) => token.length > 2));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap / Math.min(aTokens.size, bTokens.size);
}

/**
 * Loose by design: one strong shared topic word can recall a thread ("I want
 * to talk about authorship" -> "The middle is about authorship."). The CALLER
 * must therefore only invoke this on return/pivot-shaped turns — matching every
 * substantive turn would let an ordinary answer that shares a word with an old
 * parked phrase hijack the bounded selection context.
 */
export function findMatchingOpenThread(
  threads: ParkedThread[],
  userText: string,
): ParkedThread | undefined {
  const normalizedUser = normalizedThreadText(userText);
  if (!normalizedUser) return undefined;
  return threads.find((thread) => {
    if (thread.status === "ignored" || thread.status === "stale") return false;
    const normalizedThread = normalizedThreadText(thread.text);
    if (!normalizedThread) return false;
    if (normalizedUser.includes(normalizedThread) || normalizedThread.includes(normalizedUser)) return true;
    return tokenOverlapRatio(normalizedUser, normalizedThread) >= 0.5;
  });
}

export function activateOpenThread(
  threads: ParkedThread[],
  threadId: string,
  now = Date.now(),
): ParkedThread[] {
  return threads.map((thread) =>
    thread.id === threadId && thread.status !== "ignored" && thread.status !== "stale"
      ? { ...thread, status: "active", updatedAt: now }
      : thread,
  );
}

export function ignoreActiveOpenThreads(threads: ParkedThread[], now = Date.now()): ParkedThread[] {
  return threads.map((thread) =>
    thread.status === "active" ? { ...thread, status: "ignored", updatedAt: now } : thread,
  );
}

export function promoteOpenThreadsForUtterances(
  threads: ParkedThread[],
  utteranceIds: Iterable<string>,
  now = Date.now(),
): ParkedThread[] {
  const promotedIds = new Set(utteranceIds);
  if (promotedIds.size === 0) return threads;
  return threads.map((thread) =>
    thread.status !== "ignored" &&
    thread.status !== "stale" &&
    thread.sourceUtteranceIds.some((id) => promotedIds.has(id))
      ? { ...thread, status: "promoted", updatedAt: now }
      : thread,
  );
}

export function reopenPromotedOpenThreads(threads: ParkedThread[], now = Date.now()): ParkedThread[] {
  return threads.map((thread) =>
    thread.status === "promoted" ? { ...thread, status: "parked", updatedAt: now } : thread,
  );
}

export function markStaleOpenThreads(
  threads: ParkedThread[],
  existingUtteranceIds: Iterable<string>,
  now = Date.now(),
): ParkedThread[] {
  const existing = new Set(existingUtteranceIds);
  return threads.map((thread) =>
    thread.sourceUtteranceIds.every((id) => !existing.has(id))
      ? { ...thread, status: "stale", updatedAt: now }
      : thread,
  );
}

export function unresolvedOpenThreadContext(
  threads: ParkedThread[],
  limit = 3,
): OpenThreadContext[] {
  return threads
    .filter((thread) => thread.status === "parked" || thread.status === "active")
    .slice(-limit)
    .reverse()
    .map((thread) => ({
      id: thread.id,
      text: thread.text,
      status: thread.status,
      sourceUtteranceIds: thread.sourceUtteranceIds,
    }));
}
