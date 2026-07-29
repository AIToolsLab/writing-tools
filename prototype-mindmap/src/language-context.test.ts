import { describe, expect, it } from "vitest";
import { detectLatestUserLanguagePattern } from "./language-context";

describe("latest user language pattern", () => {
  it.each([
    ["English prose", "single"],
    ["中文內容", "single"],
    ["English 和 中文", "mixed"],
    ["私は漢字とかなで書く", "single"],
    ["한국어 漢字", "single"],
    ["1234!? 🙂", "unknown"],
  ] as const)("classifies %j as %s", (text, expected) => {
    expect(detectLatestUserLanguagePattern(text)).toBe(expected);
  });

  it("returns unknown instead of guessing an unfamiliar script", () => {
    expect(detectLatestUserLanguagePattern("ሰላም")).toBe("unknown");
  });
});
