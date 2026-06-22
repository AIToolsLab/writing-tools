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
