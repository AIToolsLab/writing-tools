import { describe, expect, it } from "vitest";
import { segment, stem } from "./normalize";

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
});

describe("stem (variant convergence)", () => {
  it("converges organize / organizing", () => {
    expect(stem("organize")).toBe(stem("organizing"));
  });
  it("converges node / nodes", () => {
    expect(stem("node")).toBe(stem("nodes"));
  });
});
