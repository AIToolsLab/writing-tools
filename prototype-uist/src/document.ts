import type {
  DocumentInsertRequest,
  DocumentInsertResult,
  InsertionTarget,
  WordBankItem,
} from "./types";

function success(
  nextDraft: string,
  insertedRange: DocumentInsertResult["insertedRange"],
): DocumentInsertResult {
  return {
    guardrail: {
      ok: true,
      code: "OK",
      message: "Inserted approved word-bank text into the document.",
    },
    nextDraft,
    insertedRange,
  };
}

function failure(
  code: DocumentInsertResult["guardrail"]["code"],
  message: string,
): DocumentInsertResult {
  return {
    guardrail: {
      ok: false,
      code,
      message,
    },
  };
}

export function describeTarget(target: InsertionTarget): string {
  switch (target.kind) {
    case "selection":
      return "Replace the current selection";
    case "cursor":
      return "Insert at the cursor";
    case "append":
      return "Append to the end";
    case "placeholder":
      return target.placeholder
        ? `Replace placeholder "${target.placeholder}"`
        : "Replace placeholder";
    case "before_paragraph":
      return "Place before the highlighted paragraph";
    case "after_paragraph":
      return "Place after the highlighted paragraph";
  }
}

export function findParagraphRangeForAnchor(
  draft: string,
  anchorText?: string,
): { start: number; end: number } | null {
  const trimmedAnchor = anchorText?.trim();
  if (!trimmedAnchor) {
    return null;
  }

  const anchorIndex = draft.indexOf(trimmedAnchor);
  if (anchorIndex < 0) {
    return null;
  }

  const paragraphStartIndex = draft.lastIndexOf("\n\n", anchorIndex - 1);
  const paragraphEndIndex = draft.indexOf("\n\n", anchorIndex + trimmedAnchor.length);
  const start = paragraphStartIndex < 0 ? 0 : paragraphStartIndex + 2;
  const end = paragraphEndIndex < 0 ? draft.length : paragraphEndIndex;
  return { start, end };
}

function findSentenceBoundaryBefore(text: string, index: number): number {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const char = text[cursor];
    if (char === "\n") {
      return cursor + 1;
    }
    if (char === "." || char === "!" || char === "?") {
      return cursor + 1;
    }
  }
  return 0;
}

function findSentenceBoundaryAfter(text: string, index: number): number {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === "\n" || char === "." || char === "!" || char === "?") {
      return cursor + 1;
    }
  }
  return text.length;
}

export function findFocusRangeForAnchor(
  draft: string,
  anchorText?: string,
  maxLength = 420,
): { start: number; end: number } | null {
  const trimmedAnchor = anchorText?.trim();
  if (!trimmedAnchor) {
    return null;
  }

  const anchorIndex = draft.indexOf(trimmedAnchor);
  if (anchorIndex < 0) {
    return null;
  }

  const paragraphRange = findParagraphRangeForAnchor(draft, trimmedAnchor);
  if (!paragraphRange) {
    return null;
  }

  if (paragraphRange.end - paragraphRange.start <= maxLength) {
    return paragraphRange;
  }

  const sentenceStart = Math.max(
    paragraphRange.start,
    findSentenceBoundaryBefore(draft, anchorIndex),
  );
  const sentenceEnd = Math.min(
    paragraphRange.end,
    findSentenceBoundaryAfter(draft, anchorIndex + trimmedAnchor.length),
  );
  if (sentenceEnd - sentenceStart <= maxLength) {
    return { start: sentenceStart, end: sentenceEnd };
  }

  const halfWindow = Math.floor(maxLength / 2);
  const start = Math.max(paragraphRange.start, anchorIndex - halfWindow);
  const end = Math.min(
    paragraphRange.end,
    anchorIndex + trimmedAnchor.length + halfWindow,
  );
  return { start, end };
}

export function getFocusRangeForTarget(
  draft: string,
  target: InsertionTarget,
): { start: number; end: number } | null {
  switch (target.kind) {
    case "selection":
      if (
        typeof target.start === "number" &&
        typeof target.end === "number" &&
        target.end > target.start
      ) {
        return { start: target.start, end: target.end };
      }
      return null;
    case "placeholder": {
      const placeholder = target.placeholder?.trim();
      if (!placeholder) {
        return null;
      }
      const start = draft.indexOf(placeholder);
      if (start < 0) {
        return null;
      }
      return { start, end: start + placeholder.length };
    }
    case "before_paragraph":
    case "after_paragraph":
      return findFocusRangeForAnchor(draft, target.anchorText);
    case "cursor":
    case "append":
      return null;
  }
}

function ensureApprovedItem(bankItem: WordBankItem): DocumentInsertResult | null {
  if (bankItem.status !== "approved") {
    return failure(
      "BANK_ITEM_NOT_APPROVED",
      "Only approved word-bank items can be inserted into the document.",
    );
  }
  return null;
}

function insertAsParagraph(
  draft: string,
  insertionIndex: number,
  text: string,
): { nextDraft: string; insertedRange: { start: number; end: number } } {
  const trimmedText = text.trim();
  const before = draft.slice(0, insertionIndex);
  const after = draft.slice(insertionIndex);
  const prefix =
    before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const suffix =
    after.length === 0 || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  const insertedText = `${prefix}${trimmedText}${suffix}`;
  const nextDraft = `${before}${insertedText}${after}`;
  const start = before.length + prefix.length;
  return {
    nextDraft,
    insertedRange: { start, end: start + trimmedText.length },
  };
}

export function insertBankText(
  request: DocumentInsertRequest,
): DocumentInsertResult {
  const itemGuard = ensureApprovedItem(request.bankItem);
  if (itemGuard) {
    return itemGuard;
  }

  if (request.textToInsert !== request.bankItem.text) {
    return failure(
      "INSERT_TEXT_MISMATCH",
      "Document insertion only accepts the exact current bank-item text.",
    );
  }

  const text = request.bankItem.text;
  switch (request.target.kind) {
    case "append": {
      const start = request.draft.length;
      const nextDraft = `${request.draft}${text}`;
      return success(nextDraft, { start, end: start + text.length });
    }
    case "cursor": {
      const cursorIndex = request.target.start ?? request.draft.length;
      const nextDraft = `${request.draft.slice(0, cursorIndex)}${text}${request.draft.slice(cursorIndex)}`;
      return success(nextDraft, {
        start: cursorIndex,
        end: cursorIndex + text.length,
      });
    }
    case "selection": {
      const start = request.target.start;
      const end = request.target.end;
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        start < 0 ||
        end <= start
      ) {
        return failure(
          "INVALID_SELECTION",
          "A valid selection range is required for selection-based insertion.",
        );
      }

      const nextDraft = `${request.draft.slice(0, start)}${text}${request.draft.slice(end)}`;
      return success(nextDraft, {
        start,
        end: start + text.length,
      });
    }
    case "before_paragraph":
    case "after_paragraph": {
      const paragraphRange = findParagraphRangeForAnchor(
        request.draft,
        request.target.anchorText,
      );
      if (!paragraphRange) {
        return failure(
          "ANCHOR_NOT_FOUND",
          "The highlighted paragraph for this suggestion could not be found in the document.",
        );
      }

      const insertionIndex =
        request.target.kind === "before_paragraph"
          ? paragraphRange.start
          : paragraphRange.end;
      const { nextDraft, insertedRange } = insertAsParagraph(
        request.draft,
        insertionIndex,
        text,
      );
      return success(nextDraft, insertedRange);
    }
    case "placeholder": {
      const placeholder = request.target.placeholder?.trim();
      if (!placeholder) {
        return failure(
          "PLACEHOLDER_NOT_FOUND",
          "A placeholder is required for placeholder replacement.",
        );
      }

      const start = request.draft.indexOf(placeholder);
      if (start < 0) {
        return failure(
          "PLACEHOLDER_NOT_FOUND",
          "The chosen placeholder could not be found in the document.",
        );
      }

      const end = start + placeholder.length;
      const nextDraft = `${request.draft.slice(0, start)}${text}${request.draft.slice(end)}`;
      return success(nextDraft, {
        start,
        end: start + text.length,
      });
    }
  }
}
