import {
  createOwnershipValidator,
  findMatchingUserMessageIds,
  normalizeForOwnership,
} from "./ownership";
import type {
  BankWriteRequest,
  BankWriteResult,
  ChatMessage,
  GuardrailResult,
  WordBankItem,
} from "./types";

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function success(item: WordBankItem, message: string): BankWriteResult {
  return {
    guardrail: { ok: true, code: "OK", message },
    item,
  };
}

function failure(guardrail: GuardrailResult): BankWriteResult {
  return { guardrail };
}

function findMessageById(messages: ChatMessage[], messageId?: string) {
  if (!messageId) {
    return undefined;
  }
  return messages.find((message) => message.id === messageId);
}

function hasDuplicateText(
  candidateText: string,
  existingItems: WordBankItem[],
  currentItemId?: string,
): boolean {
  const normalizedCandidate = normalizeForOwnership(candidateText);
  return existingItems.some(
    (item) =>
      item.id !== currentItemId &&
      normalizeForOwnership(item.text) === normalizedCandidate,
  );
}

function isBankWorthyUserText(candidateText: string): boolean {
  const trimmed = candidateText.trim();
  const normalized = normalizeForOwnership(trimmed);
  const wordCount = normalized.split(" ").filter(Boolean).length;
  if (wordCount < 4) {
    return false;
  }

  if (/[?]\s*$/.test(trimmed)) {
    return false;
  }

  const metaPatterns = [
    /^(let'?s|lets)\b/i,
    /^(can|could|would|will)\s+you\b/i,
    /^(which|what)\s+(area|section|part)\b/i,
    /^(show|tell|help)\s+me\b/i,
    /^(i\s+(want|need|would like)\s+to)\b/i,
    /\b(my text|my draft|the draft)\b/i,
  ];

  return !metaPatterns.some((pattern) => pattern.test(trimmed));
}

export function addUserTextToBank(request: BankWriteRequest): BankWriteResult {
  const sourceMessage = findMessageById(request.messages, request.messageId);
  if (!sourceMessage || sourceMessage.role !== "user") {
    return failure({
      ok: false,
      code: "INVALID_SOURCE",
      message: "Bank additions must reference a user message.",
    });
  }

  const validator = createOwnershipValidator();
  const validation = validator.validateAgainstMessages(request.candidateText, [
    sourceMessage,
  ]);
  if (!validation.ok) {
    return failure(validation);
  }

  if (request.origin === "ai" && !isBankWorthyUserText(request.candidateText)) {
    return failure({
      ok: false,
      code: "TEXT_NOT_BANK_WORTHY",
      message:
        "That wording looks like chat coordination rather than draft language, so it was kept out of the word bank.",
    });
  }

  if (hasDuplicateText(request.candidateText, request.existingItems)) {
    return failure({
      ok: false,
      code: "DUPLICATE_BANK_ITEM",
      message: "That wording is already in the word bank.",
    });
  }

  const item: WordBankItem = {
    id: createId("bank"),
    text: request.candidateText.trim(),
    sourceMessageIds: [sourceMessage.id],
    status: "proposed",
    createdBy: "ai_extract",
    lastEditedBy: "ai_extract",
    updatedAt: Date.now(),
  };

  return success(item, "Added proposed user-owned text to the bank.");
}

export function updateBankItem(request: BankWriteRequest): BankWriteResult {
  if (!request.currentItem) {
    return failure({
      ok: false,
      code: "BANK_ITEM_NOT_FOUND",
      message: "The word bank item to update was not found.",
    });
  }

  if (hasDuplicateText(request.candidateText, request.existingItems, request.currentItem.id)) {
    return failure({
      ok: false,
      code: "DUPLICATE_BANK_ITEM",
      message: "That wording is already in the word bank.",
    });
  }

  if (request.origin === "user") {
    const item: WordBankItem = {
      ...request.currentItem,
      text: request.candidateText.trim(),
      status: "approved",
      lastEditedBy: "user",
      updatedAt: Date.now(),
    };
    return success(item, "Saved your bank edit as user-owned text.");
  }

  const validation = createOwnershipValidator().validateAgainstMessages(
    request.candidateText,
    request.messages,
  );
  if (!validation.ok) {
    return failure(validation);
  }

  const sourceMessageIds = findMatchingUserMessageIds(
    request.candidateText,
    request.messages,
  );
  const item: WordBankItem = {
    ...request.currentItem,
    text: request.candidateText.trim(),
    sourceMessageIds:
      sourceMessageIds.length > 0
        ? sourceMessageIds
        : request.currentItem.sourceMessageIds,
    status: "proposed",
    lastEditedBy: "ai_edit",
    updatedAt: Date.now(),
  };

  return success(item, "Saved an AI-edited bank item after ownership validation.");
}

export function setBankItemStatus(
  item: WordBankItem,
  status: WordBankItem["status"],
): WordBankItem {
  return {
    ...item,
    status,
    updatedAt: Date.now(),
  };
}

export function resolveApprovedBankText(
  candidateText: string,
  items: WordBankItem[],
): WordBankItem | null {
  const trimmedCandidate = candidateText.trim();
  const normalizedCandidate = normalizeForOwnership(trimmedCandidate);
  if (!normalizedCandidate) {
    return null;
  }

  const approvedItems = items.filter((item) => item.status === "approved");
  const exactMatch =
    approvedItems.find(
      (item) => normalizeForOwnership(item.text) === normalizedCandidate,
    ) ?? null;
  if (exactMatch) {
    return exactMatch;
  }

  const containingMatch =
    approvedItems.find((item) =>
      normalizeForOwnership(item.text).includes(normalizedCandidate),
    ) ?? null;
  if (!containingMatch) {
    return null;
  }

  return {
    ...containingMatch,
    text: trimmedCandidate,
  };
}
