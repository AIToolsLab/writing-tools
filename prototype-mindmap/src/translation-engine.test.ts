import { describe, expect, it } from "vitest";
import {
  maskProtectedRegions,
  restoreProtectedRegions,
  openAiEngine,
} from "./translation-engine";
import * as api from "./api";
import { vi, afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("protected regions", () => {
  it("lifts out fenced code, inline code, URLs and addresses", () => {
    const { masked, regions } = maskProtectedRegions(
      "Run `npm test` then read https://example.com/docs or mail me@example.com",
    );
    expect(regions).toEqual(["`npm test`", "https://example.com/docs", "me@example.com"]);
    expect(masked).toBe("Run [[[0]]] then read [[[1]]] or mail [[[2]]]");
  });

  it("keeps a fenced block whole rather than translating its contents", () => {
    const source = "Before\n```js\nconst greeting = \"hello\";\n```\nAfter";
    const { masked, regions } = maskProtectedRegions(source);
    expect(regions[0]).toContain("const greeting");
    expect(masked).toBe("Before\n[[[0]]]\nAfter");
  });

  it("puts every region back exactly as it was", () => {
    const source = "See `store.get(id)` and https://example.com";
    const { masked, regions } = maskProtectedRegions(source);
    const translated = masked.replace("See", "Siehe").replace("and", "und");
    expect(restoreProtectedRegions(translated, regions)).toBe(
      "Siehe `store.get(id)` und https://example.com",
    );
  });

  it("refuses to reassemble when the engine dropped a marker", () => {
    // Splicing code back at the wrong place is worse than not translating.
    const { regions } = maskProtectedRegions("Run `npm test` now");
    expect(restoreProtectedRegions("Führe jetzt aus", regions)).toBeUndefined();
  });

  it("leaves text with nothing protected untouched", () => {
    const { masked, regions } = maskProtectedRegions("just ordinary prose");
    expect(masked).toBe("just ordinary prose");
    expect(regions).toEqual([]);
  });
});

describe("openAiEngine", () => {
  it("never sends code to the engine and restores it afterwards", async () => {
    const spy = vi.spyOn(api, "postChat").mockImplementation(async (messages) => {
      const sent = messages[1].content;
      // The engine must not see the code at all.
      expect(sent).not.toContain("npm test");
      return JSON.stringify({ translation: sent.replace("Run", "Führe aus") });
    });

    const result = await openAiEngine().translate("Run `npm test`", "de");

    expect(result).toBe("Führe aus `npm test`");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("keeps the original when a marker comes back mangled", async () => {
    vi.spyOn(api, "postChat").mockResolvedValue(
      JSON.stringify({ translation: "übersetzt ohne Platzhalter" }),
    );
    await expect(openAiEngine().translate("Run `npm test`", "de")).resolves.toBe(
      "Run `npm test`",
    );
  });

  it("sends nothing when the text is only a code block", async () => {
    const spy = vi.spyOn(api, "postChat");
    await expect(openAiEngine().translate("```\nconst a = 1;\n```", "de")).resolves.toBe(
      "```\nconst a = 1;\n```",
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
