import type {
  ChatMessage,
  GuardrailResult,
  OwnershipValidator,
} from "./types";

const SMART_QUOTES_RE = /[\u2018\u2019\u201A\u201B]/g;
const SMART_DOUBLE_QUOTES_RE = /[\u201C\u201D\u201E\u201F]/g;
const NON_ALPHANUMERIC_RE = /[^\p{L}\p{N}\s]/gu;
const MULTISPACE_RE = /\s+/g;

export function normalizeForOwnership(text: string): string {
  return text
    .replace(SMART_QUOTES_RE, "'")
    .replace(SMART_DOUBLE_QUOTES_RE, '"')
    .replace(NON_ALPHANUMERIC_RE, " ")
    .replace(MULTISPACE_RE, " ")
    .trim()
    .toLowerCase();
}

function success(message = "Text passed ownership validation."): GuardrailResult {
  return { ok: true, code: "OK", message };
}

function failure(
  code: GuardrailResult["code"],
  message: string,
): GuardrailResult {
  return { ok: false, code, message };
}

export function validateUserOwnedText(
  candidateText: string,
  sourceTexts: string[],
): GuardrailResult {
  const normalizedCandidate = normalizeForOwnership(candidateText);
  if (!normalizedCandidate) {
    return failure("EMPTY_TEXT", "The text is empty after normalization.");
  }

  const matchingText = sourceTexts.find((sourceText) =>
    normalizeForOwnership(sourceText).includes(normalizedCandidate),
  );

  if (!matchingText) {
    return failure(
      "TEXT_NOT_USER_OWNED",
      "The text does not match user-owned wording from the provided source messages.",
    );
  }

  return success();
}

export function findMatchingUserMessageIds(
  candidateText: string,
  messages: ChatMessage[],
): string[] {
  const normalizedCandidate = normalizeForOwnership(candidateText);
  if (!normalizedCandidate) {
    return [];
  }

  return messages
    .filter((message) => message.role === "user")
    .filter((message) =>
      normalizeForOwnership(message.text).includes(normalizedCandidate),
    )
    .map((message) => message.id);
}

export function createOwnershipValidator(): OwnershipValidator {
  return {
    normalize: normalizeForOwnership,
    validateAgainstMessages(candidateText, messages) {
      const userTexts = messages
        .filter((message) => message.role === "user")
        .map((message) => message.text);

      return validateUserOwnedText(candidateText, userTexts);
    },
  };
}
