import { beforeEach, describe, expect, it, vi } from "vitest";
import { translateContent } from "./translate";
import { clearTranslationMemory } from "./translation-memory";
import type { TranslationEngine } from "./translation-engine";

/** Marks each result with the language it was asked for, so misuse is visible. */
function fakeEngine(): TranslationEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async translate(text, targetLang) {
      calls.push(text);
      return `[${targetLang}]${text}`;
    },
  };
}

// Translations are remembered across calls by design, so each test has to start
// from an empty memory or it would be answered by an earlier test's results.
beforeEach(() => {
  clearTranslationMemory();
});

describe("translateContent", () => {
  it("translates each piece in order", async () => {
    const engine = fakeEngine();
    const result = await translateContent(["one", "two", "three"], "de", engine);
    expect(result).toEqual(["[de]one", "[de]two", "[de]three"]);
  });

  it("passes blank entries through without sending them", async () => {
    const engine = fakeEngine();
    const result = await translateContent(["", "real", "   "], "de", engine);
    // Positions are preserved so callers can index by position.
    expect(result).toEqual(["", "[de]real", "   "]);
    expect(engine.calls).toEqual(["real"]);
  });

  it("makes no request when there is nothing translatable", async () => {
    const engine = fakeEngine();
    await translateContent(["", "  "], "de", engine);
    expect(engine.calls).toEqual([]);
  });

  it("asks for a piece once, however often it is requested", async () => {
    // Toggling the view back and forth must not be paid for twice.
    const engine = fakeEngine();
    await translateContent(["a card"], "de", engine);
    await translateContent(["a card"], "de", engine);
    await translateContent(["a card"], "de", engine);
    expect(engine.calls).toEqual(["a card"]);
  });

  it("reports a remembered piece to the progress callback", async () => {
    const engine = fakeEngine();
    await translateContent(["a card"], "de", engine);

    const seen: Array<[string, string]> = [];
    const result = await translateContent(["a card"], "de", engine, (entries) =>
      seen.push(...entries),
    );
    expect(result).toEqual(["[de]a card"]);
    expect(seen).toEqual([["a card", "[de]a card"]]);
  });

  it("does not reuse one language's answer for another", async () => {
    const engine = fakeEngine();
    await translateContent(["a card"], "de", engine);
    const result = await translateContent(["a card"], "ko", engine);
    expect(result).toEqual(["[ko]a card"]);
  });

  it("reports each piece as it lands so text can appear progressively", async () => {
    const engine = fakeEngine();
    const texts = Array.from({ length: 30 }, (_v, i) => `item ${i}`);
    const seen: Array<[string, string]> = [];

    await translateContent(texts, "de", engine, (entries) => seen.push(...entries));

    expect(new Map(seen)).toEqual(new Map(texts.map((t) => [t, `[de]${t}`])));
  });

  it("caps how many pieces are in flight at once", async () => {
    let open = 0;
    let peak = 0;
    const engine: TranslationEngine = {
      async translate(text, targetLang) {
        open += 1;
        peak = Math.max(peak, open);
        await new Promise((resolve) => setTimeout(resolve, 1));
        open -= 1;
        return `[${targetLang}]${text}`;
      },
    };

    const texts = Array.from({ length: 40 }, (_v, i) => `item ${i}`);
    const result = await translateContent(texts, "de", engine);

    expect(peak).toBeLessThanOrEqual(4);
    expect(result).toEqual(texts.map((text) => `[de]${text}`));
  });

  it("surfaces an engine failure instead of silently showing the original", async () => {
    const engine: TranslationEngine = {
      translate: vi.fn().mockRejectedValue(new Error("engine down")),
    };
    await expect(translateContent(["a"], "de", engine)).rejects.toThrow("engine down");
  });
});
