import { describe, expect, it } from "vitest";
import { containsWholePhrase, contentTokens, findWholePhraseRange, foldWidthAndQuotes, segment, stem, tokenize } from "./normalize";

describe("segment", () => {
  it("splits a multi-sentence block into units", () => {
    const parts = segment("I love writing. It clears my head. I do it daily.");
    expect(parts).toEqual(["I love writing.", "It clears my head.", "I do it daily."]);
  });

  it("splits on newlines too", () => {
    expect(segment("first idea\nsecond idea")).toEqual(["first idea", "second idea"]);
  });

  it("keeps a terminator-less block as a single unit", () => {
    expect(segment("just one running thought")).toEqual(["just one running thought"]);
  });

  it("drops empty fragments", () => {
    expect(segment("a.  \n\n  b.")).toEqual(["a.", "b."]);
  });

  it("splits Chinese sentences without requiring whitespace", () => {
    expect(segment("第一句。第二句！第三句？")).toEqual(["第一句。", "第二句！", "第三句？"]);
  });

  it("does not split English decimals or domain names without sentence whitespace", () => {
    expect(segment("Version 3.5 is documented at example.com/path.")).toEqual([
      "Version 3.5 is documented at example.com/path.",
    ]);
  });

  it("does not split inside parenthesized English punctuation", () => {
    expect(segment("I keep asking (why?) before I decide.")).toEqual([
      "I keep asking (why?) before I decide.",
    ]);
  });
});

describe("stem (variant convergence)", () => {
  it("converges organize / organizing", () => {
    expect(stem("organize")).toBe(stem("organizing"));
  });
  it("converges node / nodes", () => {
    expect(stem("node")).toBe(stem("nodes"));
  });
});

describe("containsWholePhrase", () => {
  it("does not treat a phrase as a substring of another word", () => {
    expect(containsWholePhrase("underrated", "under")).toBe(false);
    expect(containsWholePhrase("thunder", "under")).toBe(false);
    expect(containsWholePhrase("starting point", "art")).toBe(false);
    expect(containsWholePhrase("supporting evidence", "support")).toBe(false);
  });

  it("permits normalized punctuation and case differences", () => {
    expect(containsWholePhrase("Human-control matters.", "human control")).toBe(true);
  });

  it("folds punctuation width and CJK quotation styles", () => {
    expect(foldWidthAndQuotes("「控制」，很重要！")).toBe("\"控制\",很重要!");
    expect(containsWholePhrase("「控制」，很重要！", "\"控制\", 很重要!")).toBe(true);
  });

  it("locates evidence in the unchanged original string with code-owned offsets", () => {
    const original = "前文「控制权，很重要！」后文";
    const range = findWholePhraseRange(original, "\"控制权,很重要!\"");
    expect(range).toBeDefined();
    expect(original.slice(range!.start, range!.end)).toBe("控制权，很重要");
  });

  it("matches Chinese phrases without whitespace but not Simplified/Traditional substitutions", () => {
    expect(containsWholePhrase("我想保留人的控制权", "人的控制权")).toBe(true);
    expect(containsWholePhrase("我想保留人的控制权", "人的控制權")).toBe(false);
  });
});

describe("Unicode word segmentation", () => {
  it("has full-ICU Chinese segmentation support", () => {
    const words = Array.from(new Intl.Segmenter("zh", { granularity: "word" }).segment("语言塑造思想"))
      .filter((part) => part.isWordLike)
      .map((part) => part.segment);
    expect(words).toEqual(["语言", "塑造", "思想"]);
    expect(tokenize("语言塑造思想")).toEqual(words);
  });

  it("treats only the closed Chinese particle list as glue", () => {
    expect(contentTokens("语言也塑造思想的工具")).toEqual(["语言", "塑造", "思想", "工具"]);
  });
});
