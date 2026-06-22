import { describe, expect, it } from "vitest";
import {
  normalizeForOwnership,
  validateUserOwnedText,
} from "./ownership";

describe("ownership validation", () => {
  it("normalizes quotes, punctuation, spacing, and case", () => {
    expect(normalizeForOwnership(`  “Hello,   World!”  `)).toBe("hello world");
  });

  it("accepts text that matches normalized user wording", () => {
    const result = validateUserOwnedText("felt like a new chapter", [
      "I felt like a new chapter in my life was opening.",
    ]);

    expect(result.ok).toBe(true);
  });

  it("rejects text that introduces wording not found in user text", () => {
    const result = validateUserOwnedText("transformed my sense of belonging", [
      "I felt nervous walking across campus.",
    ]);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("TEXT_NOT_USER_OWNED");
  });
});
