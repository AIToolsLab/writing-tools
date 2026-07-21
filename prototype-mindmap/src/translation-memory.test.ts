// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A fresh module instance stands in for a fresh page load. */
async function reload() {
  vi.resetModules();
  return import("./translation-memory");
}

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("translation memory", () => {
  it("answers a string it has already been given", async () => {
    const memory = await reload();
    memory.rememberTranslations([["Clear chat", "清空对话"]], "zh");

    expect(memory.lookupTranslation("Clear chat", "zh")).toBe("清空对话");
  });

  it("has no answer for a string it has not seen", async () => {
    const memory = await reload();

    expect(memory.lookupTranslation("Clear chat", "zh")).toBeUndefined();
  });

  it("survives a reload, so a returning reader pays nothing", async () => {
    const first = await reload();
    first.rememberTranslations([["Clear chat", "清空对话"]], "zh");
    first.flushTranslationMemory();

    const second = await reload();
    expect(second.lookupTranslation("Clear chat", "zh")).toBe("清空对话");
  });

  it("keeps languages apart", async () => {
    const memory = await reload();
    memory.rememberTranslations([["Clear chat", "清空对话"]], "zh");

    expect(memory.lookupTranslation("Clear chat", "es")).toBeUndefined();
  });

  it("matches regardless of surrounding whitespace", async () => {
    // The DOM pass hands over text nodes with their original spacing intact.
    const memory = await reload();
    memory.rememberTranslations([["  Clear chat  ", "清空对话"]], "zh");

    expect(memory.lookupTranslation("Clear chat", "zh")).toBe("清空对话");
  });

  it("never stores a blank source", async () => {
    const memory = await reload();
    memory.rememberTranslations([["   ", "..."]], "zh");

    expect(memory.exportTranslationMemory("zh")).toEqual({});
  });

  it("exports what it learned in dictionary shape", async () => {
    const memory = await reload();
    memory.rememberTranslations(
      [
        ["Clear chat", "清空对话"],
        ["Back to writing", "回到写作"],
      ],
      "zh",
    );

    expect(memory.exportTranslationMemory("zh")).toEqual({
      "Clear chat": "清空对话",
      "Back to writing": "回到写作",
    });
  });

  it("drops the oldest entries rather than growing without limit", async () => {
    const memory = await reload();
    memory.rememberTranslations(
      Array.from({ length: 4100 }, (_unused, index): [string, string] => [
        `source ${index}`,
        `translated ${index}`,
      ]),
      "zh",
    );

    const kept = memory.exportTranslationMemory("zh");
    expect(Object.keys(kept)).toHaveLength(4000);
    expect(kept["source 0"]).toBeUndefined();
    expect(kept["source 4099"]).toBe("translated 4099");
  });

  it("starts empty when the stored value is corrupt", async () => {
    window.localStorage.setItem("mindmap.translation-memory.v1", "{not json");

    const memory = await reload();
    expect(memory.lookupTranslation("Clear chat", "zh")).toBeUndefined();
  });

  it("keeps working when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const memory = await reload();
    memory.rememberTranslations([["Clear chat", "清空对话"]], "zh");
    memory.flushTranslationMemory();

    // Still answered from this session, just not carried to the next one.
    expect(memory.lookupTranslation("Clear chat", "zh")).toBe("清空对话");
  });
});
