import { afterEach, describe, expect, it, vi } from "vitest";
import { TranslationError, translateStrings } from "./translate";
import * as api from "./api";

function mockChat(handler: (messages: api.OpenAIMessage[]) => string) {
  return vi.spyOn(api, "postChat").mockImplementation(async (messages) => handler(messages));
}

/** Echo back each input item with a marker, so order is checkable. */
function echoTranslator(messages: api.OpenAIMessage[]): string {
  const { items } = JSON.parse(messages[1].content) as { items: string[] };
  return JSON.stringify({ translations: items.map((item) => `<${item}>`) });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("translateStrings", () => {
  it("asks for the target language without declaring a source", async () => {
    // One page mixes English interface copy with the writer's own language, so
    // the source is decided per item by the model instead of being declared.
    const spy = mockChat(echoTranslator);
    await translateStrings(["hello"], "zh");

    const system = spy.mock.calls[0][0][0].content;
    expect(system).toContain("into Chinese");
    expect(system).toContain("returned unchanged");
  });

  it("translates each item in order", async () => {
    mockChat(echoTranslator);
    const result = await translateStrings(["one", "two", "three"], "en");
    expect(result).toEqual(["<one>", "<two>", "<three>"]);
  });

  it("passes blank entries through without sending them to the model", async () => {
    mockChat(echoTranslator);
    const result = await translateStrings(["", "real", "   "], "en");
    // Positions are preserved so callers can index by position.
    expect(result).toEqual(["", "<real>", "   "]);
  });

  it("makes no request when there is nothing translatable", async () => {
    const spy = mockChat(echoTranslator);
    const result = await translateStrings(["", "  "], "en");
    expect(result).toEqual(["", "  "]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("splits long input across batches and still reassembles in order", async () => {
    const spy = mockChat(echoTranslator);
    const texts = Array.from({ length: 90 }, (_v, i) => `item ${i}`);
    const result = await translateStrings(texts, "en");

    expect(spy.mock.calls.length).toBeGreaterThan(1);
    expect(result).toEqual(texts.map((text) => `<${text}>`));
  });

  it("reports each batch as it lands so text can appear progressively", async () => {
    mockChat(echoTranslator);
    const texts = Array.from({ length: 90 }, (_v, i) => `item ${i}`);
    const seen: Array<[string, string]> = [];

    await translateStrings(texts, "en", (entries) => seen.push(...entries));

    // Reported incrementally, but covering exactly what was translated.
    expect(new Map(seen)).toEqual(new Map(texts.map((t) => [t, `<${t}>`])));
  });

  it("does not report untranslated blanks to the progress callback", async () => {
    mockChat(echoTranslator);
    const seen: Array<[string, string]> = [];

    await translateStrings(["", "real"], "en", (entries) => seen.push(...entries));

    expect(seen).toEqual([["real", "<real>"]]);
  });

  it("caps how many batches are in flight at once", async () => {
    // Unbounded parallelism made a whole page fire dozens of simultaneous
    // requests, and the backend answered some of them with empty bodies.
    let inFlight = 0;
    let peak = 0;
    vi.spyOn(api, "postChat").mockImplementation(async (messages) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return echoTranslator(messages);
    });

    const texts = Array.from({ length: 200 }, (_v, i) => `item ${i}`);
    const result = await translateStrings(texts, "zh");

    expect(peak).toBeLessThanOrEqual(4);
    // Order still holds despite the workers interleaving.
    expect(result).toEqual(texts.map((text) => `<${text}>`));
  });

  it("reports a reachability failure instead of a bare JSON error", async () => {
    vi.spyOn(api, "postChat").mockRejectedValue(
      new SyntaxError("Unexpected end of JSON input"),
    );
    await expect(translateStrings(["a"], "zh")).rejects.toThrow(
      /Could not reach the translation service/,
    );
  });

  it("rejects a response whose item count does not match the request", async () => {
    // A short array would silently shift every later translation onto the wrong
    // source string, so this must fail rather than render misaligned text.
    mockChat(() => JSON.stringify({ translations: ["only one"] }));
    await expect(translateStrings(["a", "b"], "en")).rejects.toBeInstanceOf(
      TranslationError,
    );
  });

  it("rejects a response that is not valid JSON", async () => {
    mockChat(() => "not json at all");
    await expect(translateStrings(["a"], "en")).rejects.toBeInstanceOf(
      TranslationError,
    );
  });

  it("rejects a response with no translations array", async () => {
    mockChat(() => JSON.stringify({ result: ["a"] }));
    await expect(translateStrings(["a"], "en")).rejects.toBeInstanceOf(
      TranslationError,
    );
  });
});
