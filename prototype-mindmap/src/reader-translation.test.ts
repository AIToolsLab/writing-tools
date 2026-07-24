import { describe, expect, it } from "vitest";
import { mapWithConcurrency, protectReaderText, readerCacheKey, READER_TRANSLATION_CONCURRENCY } from "./reader-translation";

describe("reader display translation helpers", () => {
  it("round-trips protected code, links, mail, card references, and markers exactly", () => {
    const source = "Use `code` at https://example.test/a, mail a@b.test, see #42 and [[[7]]].\n```js\nconst x = 1;\n```";
    const protectedText = protectReaderText(source);
    expect(protectedText.text).not.toContain("https://example.test/a");
    expect(protectedText.restore("translated [[[0]]] [[[1]]] [[[2]]] [[[3]]] [[[4]]] [[[5]]]")).toContain("https://example.test/a");
    expect(protectedText.restore(protectedText.text)).toBe(source);
  });

  it("separates cached display values by target language", () => {
    expect(readerCacheKey("zh", "Clear map")).not.toBe(readerCacheKey("ar", "Clear map"));
  });

  it("caps concurrent translation work", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], async (item) => {
      active += 1; peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return item;
    });
    expect(peak).toBeLessThanOrEqual(READER_TRANSLATION_CONCURRENCY);
  });
});
