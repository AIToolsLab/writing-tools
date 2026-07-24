// @vitest-environment jsdom
import { StrictMode, createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ translateReaderText: vi.fn() }));
import { translateReaderText } from "./api";
import {
  appendReaderDisplayCache,
  clearPersistedReaderDisplayCache,
  DISPLAY_CACHE_STORAGE_KEY,
  enqueueReaderRequests,
  parseReaderDisplayCache,
  READER_LANGUAGE_STORAGE_KEY,
  readerCacheEntryBytes,
  readerDisplayCacheBytes,
  ReaderViewProvider,
  restoreReaderLanguage,
  useReaderView,
  type ReaderViewValue,
} from "./reader-view";

function ReaderProbe({ source, onReader }: { source: string; onReader: (reader: ReaderViewValue) => void }) {
  const reader = useReaderView();
  useEffect(() => onReader(reader), [onReader, reader]);
  useEffect(() => { reader.prefetch([source]); }, [reader.prefetch, source]);
  return createElement("span", undefined, reader.translate(source));
}

async function flushReaderEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

describe("reader language preference", () => {
  it("restores a supported remembered selector language", () => {
    const storage = { getItem: (key: string) => key === READER_LANGUAGE_STORAGE_KEY ? "zh-CN" : null };
    expect(restoreReaderLanguage(storage)).toBe("zh");
  });

  it("drops an invalid stored target", () => {
    const storage = { getItem: () => "not-a-language" };
    expect(restoreReaderLanguage(storage)).toBeNull();
  });
});

describe("reader display cache", () => {
  it("deduplicates committed requests and excludes in-flight or failed strings", () => {
    const unavailable = new Set(["zh\u0000same", "zh\u0000failed"]);
    const first = enqueueReaderRequests(new Set(), ["same", "same", "failed", "new"], "zh", {}, unavailable);
    expect(Array.from(first)).toEqual(["new"]);
    const strictModeReplay = enqueueReaderRequests(first, ["new", "later"], "zh", {}, unavailable);
    expect(Array.from(strictModeReplay).sort()).toEqual(["later", "new"]);
  });

  it("loads the legacy record cache and writes entries in FIFO order", () => {
    const restored = parseReaderDisplayCache(JSON.stringify({ "zh\u0000first": "一", "zh\u0000second": "二" }));
    expect(restored.entries).toEqual([["zh\u0000first", "一"], ["zh\u0000second", "二"]]);
    const limit = readerCacheEntryBytes("zh\u0000second", "二") + readerCacheEntryBytes("zh\u0000third", "三");
    const next = appendReaderDisplayCache(restored, [["zh\u0000third", "三"]], limit);
    expect(next.entries).toEqual([["zh\u0000second", "二"], ["zh\u0000third", "三"]]);
    expect(readerDisplayCacheBytes(next)).toBeLessThanOrEqual(limit);
  });

  it("drops source-equals-translation entries left by the failed-request cache bug", () => {
    const restored = parseReaderDisplayCache(JSON.stringify({ "zh\u0000failed wording": "failed wording", "zh\u0000success": "成功" }));
    expect(restored.entries).toEqual([["zh\u0000success", "成功"]]);
  });

  it("never treats an original fallback as a successful display translation", () => {
    const cache = appendReaderDisplayCache({ entries: [] }, [["zh\u0000translated", "译文"]]);
    expect(cache.entries).toEqual([["zh\u0000translated", "译文"]]);
    expect(cache.entries.find(([key]) => key === "zh\u0000failed original")).toBeUndefined();
  });

  it("purges only the display-cache storage key", () => {
    const removeItem = vi.fn();
    clearPersistedReaderDisplayCache({ removeItem });
    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith(DISPLAY_CACHE_STORAGE_KEY);
  });
});

describe("reader translation scheduling", () => {
  let container: HTMLDivElement;
  let root: Root;
  let current: ReaderViewValue | undefined;
  const onReader = (reader: ReaderViewValue) => { current = reader; };
  const translateMock = vi.mocked(translateReaderText);

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    current = undefined;
    translateMock.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("does not cache failures or duplicate StrictMode requests, and retries on a new view activation", async () => {
    translateMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("译文");
    act(() => root.render(createElement(StrictMode, undefined, createElement(ReaderViewProvider, undefined, createElement(ReaderProbe, { source: "author wording", onReader })) )));
    await flushReaderEffects();
    expect(current).toBeDefined();
    act(() => current!.setTargetLocale("zh"));
    await flushReaderEffects();
    expect(translateMock).toHaveBeenCalledTimes(1);
    expect(current?.status).toBe("partial");
    expect(container.textContent).toBe("author wording");
    expect(window.localStorage.getItem(DISPLAY_CACHE_STORAGE_KEY)).toBeNull();

    act(() => current!.setTargetLocale(null));
    await flushReaderEffects();
    expect(current?.targetLocale).toBeNull();
    act(() => current!.setTargetLocale("zh"));
    await flushReaderEffects();
    expect(translateMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("译文");
    expect(parseReaderDisplayCache(window.localStorage.getItem(DISPLAY_CACHE_STORAGE_KEY)).entries).toEqual([["zh\u0000author wording", "译文"]]);
  });

  it("discards a stale language completion before it can enter the display cache", async () => {
    let resolveTranslation: ((value: string) => void) | undefined;
    translateMock.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveTranslation = resolve; }));
    act(() => root.render(createElement(ReaderViewProvider, undefined, createElement(ReaderProbe, { source: "author wording", onReader }))));
    await flushReaderEffects();
    expect(current).toBeDefined();
    act(() => current!.setTargetLocale("zh"));
    await flushReaderEffects();
    expect(translateMock).toHaveBeenCalledTimes(1);
    act(() => current!.setTargetLocale("ar"));
    await act(async () => { resolveTranslation!("旧译文"); await Promise.resolve(); });
    await flushReaderEffects();
    expect(current?.targetLocale).toBe("ar");
    expect(parseReaderDisplayCache(window.localStorage.getItem(DISPLAY_CACHE_STORAGE_KEY)).entries).toEqual([]);
  });

  it("clears a prior read-only rejection whenever the reader view changes", async () => {
    act(() => root.render(createElement(ReaderViewProvider, undefined, createElement(ReaderProbe, { source: "author wording", onReader }))));
    await flushReaderEffects();
    act(() => current!.reportReadOnlyRejection());
    expect(current?.rejection).toMatchObject({ id: 1, code: "return_to_original_to_edit" });
    act(() => current!.setTargetLocale(null));
    expect(current?.rejection).toBeNull();
  });
});
