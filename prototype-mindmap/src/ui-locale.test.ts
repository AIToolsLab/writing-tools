import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  UI_LOCALE_STORAGE_KEY,
  applyDocumentLocale,
  defaultUiLocale,
  normalizeUiLocale,
  persistUiLocale,
  restoreUiLocale,
  uiDirection,
  uiLocaleOptions,
} from "./ui-locale";
import { uiString } from "./ui-strings";

describe("UI locale", () => {
  it("normalizes supported browser locales and falls back to English", () => {
    expect(defaultUiLocale("zh-CN")).toBe("zh");
    expect(defaultUiLocale("ar-SA")).toBe("ar");
    expect(normalizeUiLocale("xx-YY")).toBe("en");
  });

  it("restores and persists a valid preference independently", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    persistUiLocale(storage, "zh-CN");
    expect(values.get(UI_LOCALE_STORAGE_KEY)).toBe("zh");
    expect(restoreUiLocale(storage, "en-US")).toBe("zh");
    values.set(UI_LOCALE_STORAGE_KEY, "unsupported");
    expect(restoreUiLocale(storage, "ar-SA")).toBe("ar");
  });

  it("marks Arabic-family interface locales as RTL", () => {
    expect(uiDirection("ar")).toBe("rtl");
    expect(uiDirection("he-IL")).toBe("rtl");
    expect(uiDirection("zh")).toBe("ltr");
  });

  it("applies normalized language and direction to the document root", () => {
    const root = { lang: "", dir: "" };
    applyDocumentLocale(root, "ar-SA");
    expect(root).toEqual({ lang: "ar", dir: "rtl" });
  });

  it("offers English plus every translated locale with recognizable labels", () => {
    const options = uiLocaleOptions("zh");
    expect(options.some((option) => option.code === "en")).toBe(true);
    expect(options.some((option) => option.code === "zh" && option.nativeLabel.length > 0)).toBe(true);
    expect(options.some((option) => option.code === "source")).toBe(false);
  });

  it("uses Chinese static copy and safely falls back for missing UI strings", () => {
    expect(uiString("Clear map", "zh")).toBeTypeOf("string");
    expect(uiString("Clear map", "zh")).not.toBe("Clear map");
    expect(uiString("CLEAR MAP", "zh")).toBe(uiString("Clear map", "zh"));
    expect(uiString("writer-authored Clear map", "zh")).toBeUndefined();
    expect(uiString("AI-translated", "zh")).toBe("AI 翻译");
  });

  it("has Chinese coverage for every literal explicitly opted into UI localization", () => {
    const sources = ["App.tsx", "Map.tsx"].map((file) =>
      readFileSync(new URL(`./${file}`, import.meta.url), "utf8"),
    );
    const keys = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/\bt\("([^"]+)"\)/g)) keys.add(match[1]);
      for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) keys.add(match[1]);
    }
    [
      "Working...",
      "Making sure this stays in your words...",
      "Asking a focused question instead...",
      "I couldn’t complete that response reliably. You can rephrase or try again.",
    ].forEach((key) => keys.add(key));
    const missing = [...keys].filter((key) => uiString(key, "zh") === undefined);
    expect(missing).toEqual([]);
  });
});
