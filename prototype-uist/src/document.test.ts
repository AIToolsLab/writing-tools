import { describe, expect, it } from "vitest";
import {
  findFocusRangeForAnchor,
  findParagraphRangeForAnchor,
  insertBankText,
} from "./document";
import type { WordBankItem } from "./types";

const approvedItem: WordBankItem = {
  id: "bank-1",
  text: "I walked through Calvin's campus",
  sourceMessageIds: ["msg-1"],
  status: "approved",
  createdBy: "ai_extract",
  lastEditedBy: "user",
  updatedAt: 1,
};

describe("document insertion guardrails", () => {
  it("inserts the exact approved bank text at the cursor", () => {
    const result = insertBankText({
      draft: "Intro paragraph. ",
      bankItem: approvedItem,
      target: { kind: "cursor", start: 17 },
      textToInsert: approvedItem.text,
    });

    expect(result.guardrail.ok).toBe(true);
    expect(result.nextDraft).toBe(
      "Intro paragraph. I walked through Calvin's campus",
    );
  });

  it("rejects insertion when the request text does not exactly match the bank item", () => {
    const result = insertBankText({
      draft: "Intro paragraph. ",
      bankItem: approvedItem,
      target: { kind: "append" },
      textToInsert: "A polished new sentence",
    });

    expect(result.guardrail.ok).toBe(false);
    expect(result.guardrail.code).toBe("INSERT_TEXT_MISMATCH");
  });

  it("rejects insertion when the bank item is not approved", () => {
    const result = insertBankText({
      draft: "Intro paragraph. ",
      bankItem: { ...approvedItem, status: "proposed" },
      target: { kind: "append" },
      textToInsert: approvedItem.text,
    });

    expect(result.guardrail.ok).toBe(false);
    expect(result.guardrail.code).toBe("BANK_ITEM_NOT_APPROVED");
  });

  it("replaces a placeholder when the placeholder exists", () => {
    const result = insertBankText({
      draft: "Opening [INSERT HERE] closing",
      bankItem: approvedItem,
      target: { kind: "placeholder", placeholder: "[INSERT HERE]" },
      textToInsert: approvedItem.text,
    });

    expect(result.guardrail.ok).toBe(true);
    expect(result.nextDraft).toBe(
      "Opening I walked through Calvin's campus closing",
    );
  });

  it("inserts before the anchored paragraph", () => {
    const result = insertBankText({
      draft: "Intro paragraph.\n\nBody paragraph about theology.\n\nReferences",
      bankItem: approvedItem,
      target: {
        kind: "before_paragraph",
        anchorText: "Body paragraph about theology.",
      },
      textToInsert: approvedItem.text,
    });

    expect(result.guardrail.ok).toBe(true);
    expect(result.nextDraft).toBe(
      "Intro paragraph.\n\nI walked through Calvin's campus\n\nBody paragraph about theology.\n\nReferences",
    );
  });

  it("finds the paragraph range for an anchor snippet", () => {
    const range = findParagraphRangeForAnchor(
      "Intro paragraph.\n\nBody paragraph about theology.\n\nReferences",
      "theology",
    );

    expect(range).toEqual({ start: 18, end: 48 });
  });

  it("inserts after a single-newline-separated paragraph instead of at the document end", () => {
    const draft =
      "Intro line.\nBarcelona emerged victorious in the final.\nConclusion line.\nWorks Cited";
    const result = insertBankText({
      draft,
      bankItem: approvedItem,
      target: {
        kind: "after_paragraph",
        anchorText: "Barcelona emerged victorious in the final.",
      },
      textToInsert: approvedItem.text,
    });

    expect(result.guardrail.ok).toBe(true);
    const insertedAt = result.nextDraft?.indexOf(approvedItem.text) ?? -1;
    const conclusionAt = result.nextDraft?.indexOf("Conclusion line.") ?? -1;
    const worksCitedAt = result.nextDraft?.indexOf("Works Cited") ?? -1;
    // Must land right after the Barcelona line — before the conclusion and Works
    // Cited — not appended at the very end of the document.
    expect(insertedAt).toBeGreaterThan(0);
    expect(insertedAt).toBeLessThan(conclusionAt);
    expect(insertedAt).toBeLessThan(worksCitedAt);
  });

  it("inserts after the anchored line in a mixed draft (single-newline body, blank line before Works Cited)", () => {
    const draft =
      "Intro.\nBarcelona emerged victorious in the final.\nConclusion line.\n\nWorks Cited";
    const result = insertBankText({
      draft,
      bankItem: approvedItem,
      target: {
        kind: "after_paragraph",
        anchorText: "Barcelona emerged victorious in the final.",
      },
      textToInsert: approvedItem.text,
    });

    expect(result.guardrail.ok).toBe(true);
    const insertedAt = result.nextDraft?.indexOf(approvedItem.text) ?? -1;
    const conclusionAt = result.nextDraft?.indexOf("Conclusion line.") ?? -1;
    const worksCitedAt = result.nextDraft?.indexOf("Works Cited") ?? -1;
    // Must land right after Barcelona — the lone blank line before Works Cited
    // must not pull the insertion to the end of the document.
    expect(insertedAt).toBeGreaterThan(0);
    expect(insertedAt).toBeLessThan(conclusionAt);
    expect(insertedAt).toBeLessThan(worksCitedAt);
  });

  it("limits focus highlighting when the anchored paragraph is very long", () => {
    const draft = `Heading\n${"A very long body sentence without blank-line breaks ".repeat(30)}anchor phrase continues here and keeps going.`;
    const range = findFocusRangeForAnchor(draft, "anchor phrase");

    expect(range).not.toBeNull();
    expect((range?.end ?? 0) - (range?.start ?? 0)).toBeLessThanOrEqual(420);
  });
});
