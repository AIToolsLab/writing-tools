import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { translateReaderText } from "./api";
import { mapWithConcurrency, protectReaderText, readerCacheKey } from "./reader-translation";
import { isSupportedUiLocale, normalizeUiLocale, uiLocaleOptions, type UiLocaleOption } from "./ui-locale";

export const READER_LANGUAGE_STORAGE_KEY = "prototype-mindmap-reader-language-v1";
export const DISPLAY_CACHE_STORAGE_KEY = "prototype-mindmap-reader-display-cache-v1";
export const READER_DISPLAY_CACHE_MAX_BYTES = 512 * 1024;

type ReaderRejectionCode = "return_to_original_to_edit";

export interface ReaderRejection {
  id: number;
  code: ReaderRejectionCode;
}

export interface ReaderDisplayCache {
  entries: Array<[key: string, translation: string]>;
}

export interface ReaderViewValue {
  targetLocale: string | null;
  options: UiLocaleOption[];
  isTranslatedView: boolean;
  status: "idle" | "translating" | "partial";
  rejection: ReaderRejection | null;
  /** Pure lookup: safe to call while React renders. */
  translate: (source: string) => string;
  /** Requests are scheduled from effects, never from render. */
  prefetch: (sources: readonly string[]) => void;
  /** Removes only display translations, never authored session data or preferences. */
  clearDisplayCache: () => void;
  setTargetLocale: (locale: string | null) => void;
  returnToOriginal: () => void;
  reportReadOnlyRejection: () => void;
}

const originalView: ReaderViewValue = {
  targetLocale: null, options: [], isTranslatedView: false, status: "idle", rejection: null,
  translate: (source) => source, prefetch: () => undefined, clearDisplayCache: () => undefined,
  setTargetLocale: () => undefined, returnToOriginal: () => undefined, reportReadOnlyRejection: () => undefined,
};
const ReaderViewContext = createContext<ReaderViewValue>(originalView);

export function restoreReaderLanguage(storage: Pick<Storage, "getItem"> | undefined): string | null {
  try {
    const stored = storage?.getItem(READER_LANGUAGE_STORAGE_KEY) ?? null;
    return stored && isSupportedUiLocale(stored) ? normalizeUiLocale(stored) : null;
  } catch { return null; }
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

export function readerCacheEntryBytes(key: string, translation: string): number {
  return utf8Bytes(key) + utf8Bytes(translation);
}

export function readerDisplayCacheBytes(cache: ReaderDisplayCache): number {
  return cache.entries.reduce((total, [key, translation]) => total + readerCacheEntryBytes(key, translation), 0);
}

function isEntry(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string";
}

function isLegacyFailureFallback([key, translation]: [string, string]): boolean {
  const separator = key.indexOf("\u0000");
  return separator >= 0 && key.slice(separator + 1) === translation;
}

/** Reads both the current FIFO format and the older record-only cache safely. */
export function parseReaderDisplayCache(serialized: string | null | undefined): ReaderDisplayCache {
  if (!serialized) return { entries: [] };
  try {
    const parsed: unknown = JSON.parse(serialized);
    const rawEntries = parsed && typeof parsed === "object" && "entries" in parsed
      ? (parsed as { entries?: unknown }).entries
      : parsed && typeof parsed === "object"
        ? Object.entries(parsed as Record<string, unknown>)
        : [];
    // Older 4b builds cached the untouched source when a request failed.
    // Drop that ambiguous legacy fallback so re-entering the reader view retries it.
    const entries = Array.isArray(rawEntries) ? rawEntries.filter(isEntry).filter((entry) => !isLegacyFailureFallback(entry)) : [];
    return appendReaderDisplayCache({ entries: [] }, entries);
  } catch { return { entries: [] }; }
}

function loadCache(): ReaderDisplayCache {
  try {
    if (typeof window === "undefined") return { entries: [] };
    return parseReaderDisplayCache(window.localStorage.getItem(DISPLAY_CACHE_STORAGE_KEY));
  } catch { return { entries: [] }; }
}

export function clearPersistedReaderDisplayCache(storage: Pick<Storage, "removeItem"> | undefined): void {
  try { storage?.removeItem(DISPLAY_CACHE_STORAGE_KEY); } catch { /* cache is optional */ }
}

export function readerCacheRecord(cache: ReaderDisplayCache): Record<string, string> {
  return Object.fromEntries(cache.entries);
}

/** Appends successful entries in FIFO order, dropping the oldest values first. */
export function appendReaderDisplayCache(
  current: ReaderDisplayCache,
  additions: Iterable<[key: string, translation: string]>,
  maxBytes = READER_DISPLAY_CACHE_MAX_BYTES,
): ReaderDisplayCache {
  const entriesByKey = new Map(current.entries);
  for (const [key, translation] of additions) {
    if (readerCacheEntryBytes(key, translation) > maxBytes) continue;
    // Delete before reinserting so a refreshed successful value becomes the
    // newest FIFO entry without scanning or re-summing the cache.
    entriesByKey.delete(key);
    entriesByKey.set(key, translation);
  }
  const next = [...entriesByKey.entries()];
  let totalBytes = readerDisplayCacheBytes({ entries: next });
  let firstRetained = 0;
  while (firstRetained < next.length && totalBytes > maxBytes) {
    const [key, translation] = next[firstRetained++]!;
    totalBytes -= readerCacheEntryBytes(key, translation);
  }
  return { entries: firstRetained === 0 ? next : next.slice(firstRetained) };
}

export function enqueueReaderRequests(
  current: ReadonlySet<string>,
  sources: readonly string[],
  locale: string,
  cache: Record<string, string>,
  unavailable: ReadonlySet<string> = new Set(),
): Set<string> {
  const next = new Set(current);
  for (const source of sources) {
    const key = readerCacheKey(locale, source);
    if (source && cache[key] === undefined && !unavailable.has(key)) next.add(source);
  }
  return next;
}

/** Effect-only helper for individual dynamic display values. */
export function useReaderText(source: string): string {
  const reader = useReaderView();
  useEffect(() => { reader.prefetch([source]); }, [reader.prefetch, source]);
  return reader.translate(source);
}

export function ReaderViewProvider({ children }: { children?: ReactNode }) {
  const [lastTargetLocale, setLastTargetLocale] = useState<string | null>(() => restoreReaderLanguage(typeof window === "undefined" ? undefined : window.localStorage));
  // A remembered preference must never reopen a session in a read-only display mode.
  const [targetLocale, setActiveTargetLocale] = useState<string | null>(null);
  const [cache, setCache] = useState<ReaderDisplayCache>(loadCache);
  const [status, setStatus] = useState<ReaderViewValue["status"]>("idle");
  const [rejection, setRejection] = useState<ReaderRejection | null>(null);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [queueTick, setQueueTick] = useState(0);
  const running = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef<Set<string>>(new Set());
  const failed = useRef<Set<string>>(new Set());
  const cacheValues = useMemo(() => readerCacheRecord(cache), [cache]);

  const prefetch = useCallback((sources: readonly string[]) => {
    if (!targetLocale) return;
    setQueued((current) => {
      const unavailable = new Set([...inFlight.current, ...failed.current]);
      const next = enqueueReaderRequests(current, sources, targetLocale, cacheValues, unavailable);
      return next.size === current.size ? current : next;
    });
  }, [cacheValues, targetLocale]);

  useEffect(() => {
    const locale = targetLocale;
    if (!locale || running.current || queued.size === 0) return;
    running.current = true;
    const requestGeneration = generation.current;
    const requestInFlight = inFlight.current;
    const requestFailed = failed.current;
    const sources = [...queued];
    const keys = sources.map((source) => readerCacheKey(locale, source));
    keys.forEach((key) => requestInFlight.add(key));
    setQueued((current) => {
      const next = new Set(current);
      sources.forEach((source) => next.delete(source));
      return next;
    });
    setStatus("translating");
    void (async () => {
      const additions = new Map<string, string>();
      let hadFailure = false;
      await mapWithConcurrency(sources, async (source) => {
        const key = readerCacheKey(locale, source);
        try {
          const protectedText = protectReaderText(source);
          additions.set(key, protectedText.restore(await translateReaderText(protectedText.text, locale)));
        } catch {
          // The authoritative source is the only fallback. A failure never becomes cache data.
          requestFailed.add(key);
          hadFailure = true;
        }
      });
      keys.forEach((key) => requestInFlight.delete(key));
      if (requestGeneration === generation.current && locale === targetLocale) {
        if (additions.size > 0) {
          setCache((previous) => {
            const next = appendReaderDisplayCache(previous, additions.entries());
            try {
              if (typeof window !== "undefined") window.localStorage.setItem(DISPLAY_CACHE_STORAGE_KEY, JSON.stringify(next));
            } catch { /* cache is optional */ }
            return next;
          });
        }
        setStatus(hadFailure ? "partial" : "idle");
      }
      running.current = false;
      setQueueTick((value) => value + 1);
    })();
  }, [queueTick, queued, targetLocale]);

  const translate = useCallback((source: string) => {
    if (!targetLocale || !source) return source;
    return cacheValues[readerCacheKey(targetLocale, source)] ?? source;
  }, [cacheValues, targetLocale]);

  const resetRequestGeneration = useCallback(() => {
    generation.current += 1;
    inFlight.current = new Set();
    failed.current = new Set();
    setQueued(new Set());
    setStatus("idle");
  }, []);

  const setTargetLocale = useCallback((locale: string | null) => {
    resetRequestGeneration();
    setRejection(null);
    setActiveTargetLocale(locale);
    if (locale) {
      setLastTargetLocale(locale);
      try { if (typeof window !== "undefined") window.localStorage.setItem(READER_LANGUAGE_STORAGE_KEY, locale); } catch { /* preference is optional */ }
    }
  }, [resetRequestGeneration]);
  const returnToOriginal = useCallback(() => setTargetLocale(null), [setTargetLocale]);
  const clearDisplayCache = useCallback(() => {
    resetRequestGeneration();
    setCache({ entries: [] });
    clearPersistedReaderDisplayCache(typeof window === "undefined" ? undefined : window.localStorage);
  }, [resetRequestGeneration]);
  const reportReadOnlyRejection = useCallback(() => {
    setRejection((current) => ({ id: (current?.id ?? 0) + 1, code: "return_to_original_to_edit" }));
  }, []);
  const options = useMemo(() => uiLocaleOptions(lastTargetLocale ?? "en"), [lastTargetLocale]);
  const value = useMemo<ReaderViewValue>(() => ({ targetLocale, options, isTranslatedView: targetLocale !== null, status, rejection, translate, prefetch, clearDisplayCache, setTargetLocale, returnToOriginal, reportReadOnlyRejection }), [clearDisplayCache, options, prefetch, rejection, reportReadOnlyRejection, returnToOriginal, setTargetLocale, status, targetLocale, translate]);
  return <ReaderViewContext.Provider value={value}>{children}</ReaderViewContext.Provider>;
}

export function useReaderView(): ReaderViewValue { return useContext(ReaderViewContext); }
