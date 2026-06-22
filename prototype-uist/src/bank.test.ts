import { describe, expect, it } from "vitest";
import { addUserTextToBank, updateBankItem } from "./bank";
import type { ChatMessage, WordBankItem } from "./types";

const userMessage: ChatMessage = {
  id: "msg-1",
  role: "user",
  text: "I walked through Calvin's campus and felt like a new chapter was opening.",
  timestamp: 1,
  inputType: "typed",
};

const baseItem: WordBankItem = {
  id: "bank-1",
  text: "I walked through Calvin's campus",
  sourceMessageIds: ["msg-1"],
  status: "approved",
  createdBy: "ai_extract",
  lastEditedBy: "ai_extract",
  updatedAt: 1,
};

describe("word bank guardrails", () => {
  it("adds user-owned text when it matches a user message", () => {
    const result = addUserTextToBank({
      candidateText: "felt like a new chapter was opening",
      existingItems: [],
      messageId: userMessage.id,
      messages: [userMessage],
      origin: "ai",
    });

    expect(result.guardrail.ok).toBe(true);
    expect(result.item?.status).toBe("proposed");
  });

  it("rejects an AI bank write that contains novel wording", () => {
    const result = addUserTextToBank({
      candidateText: "transformed my understanding of belonging",
      existingItems: [],
      messageId: userMessage.id,
      messages: [userMessage],
      origin: "ai",
    });

    expect(result.guardrail.ok).toBe(false);
    expect(result.guardrail.code).toBe("TEXT_NOT_USER_OWNED");
  });

  it("accepts a user manual edit and marks it approved", () => {
    const result = updateBankItem({
      candidateText: "I walked across Calvin's campus",
      currentItem: baseItem,
      existingItems: [baseItem],
      messages: [userMessage],
      origin: "user",
    });

    expect(result.guardrail.ok).toBe(true);
    expect(result.item?.status).toBe("approved");
    expect(result.item?.lastEditedBy).toBe("user");
  });

  it("rejects an AI edit that is not grounded in user messages", () => {
    const result = updateBankItem({
      candidateText: "I discovered a transformed sense of belonging",
      currentItem: baseItem,
      existingItems: [baseItem],
      messages: [userMessage],
      origin: "ai",
    });

    expect(result.guardrail.ok).toBe(false);
    expect(result.guardrail.code).toBe("TEXT_NOT_USER_OWNED");
  });
});
