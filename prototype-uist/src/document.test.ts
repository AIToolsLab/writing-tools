import { describe, expect, it } from "vitest";
import { insertBankText } from "./document";
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
});
