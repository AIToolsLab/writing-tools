import { describe, expect, it } from "vitest";
import { hasUiDictionary, translatedLanguages, uiString } from "./ui-strings";

describe("uiString", () => {
  it("answers interface copy from the checked-in dictionary", () => {
    expect(uiString("Clear map", "zh")).toBeTypeOf("string");
    expect(uiString("Clear map", "zh")).not.toBe("Clear map");
  });

  it("has no answer for copy that is not in the dictionary", () => {
    // Copy no dictionary covers renders in English rather than reaching the
    // engine, so a partial dictionary costs coverage and never correctness.
    expect(uiString("a sentence the writer just typed", "zh")).toBeUndefined();
  });

  it("never answers for English, which is the language copy is authored in", () => {
    expect(uiString("Clear map", "en")).toBeUndefined();
  });

  it("has no answer for a language with no dictionary at all", () => {
    expect(uiString("Clear map", "xx")).toBeUndefined();
    expect(hasUiDictionary("xx")).toBe(false);
  });

  it("ignores surrounding whitespace, which text nodes carry", () => {
    expect(uiString("  Clear map  ", "zh")).toBe(uiString("Clear map", "zh"));
  });

  it("ships a dictionary for every language the picker offers", () => {
    expect(translatedLanguages().length).toBeGreaterThan(30);
    expect(translatedLanguages()).toContain("zh");
    expect(translatedLanguages()).not.toContain("en");
  });
});
