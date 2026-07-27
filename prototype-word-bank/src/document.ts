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
    case "into_paragraph":
      return target.paragraphSide === "start"
        ? "Insert seamlessly at the start of the highlighted paragraph"
        : "Insert seamlessly into the highlighted paragraph";
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

  // A paragraph/line ends at the next single newline. This works for both
  // blank-line-separated drafts (a "\n\n" boundary's first "\n" is at the same
  // spot) and single-newline drafts. Picking a single global separator breaks
  // mixed drafts (e.g. single-newline body paragraphs but a blank line before
  // "Works Cited"), where the next "\n\n" wrongly jumps to the end of the file.
  const paragraphStartIndex = draft.lastIndexOf("\n", anchorIndex - 1);
  const paragraphEndIndex = draft.indexOf(
    "\n",
    anchorIndex + trimmedAnchor.length,
  );
  const start = paragraphStartIndex < 0 ? 0 : paragraphStartIndex + 1;
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
    case "into_paragraph":
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
  // Match the separator that already exists *at this boundary*, not a single
  // dominant style for the whole draft. A global guess is wrong for mixed drafts
  // (e.g. single-newline body but a blank line before "Works Cited"): one blank
  // region would force "\n\n" onto single-newline insertions. The local newline
  // run on whichever side of the insertion point has one tells us the real style.
  const boundaryRun =
    (after.match(/^\n+/)?.[0] ?? "") || (before.match(/\n+$/)?.[0] ?? "");
  const sep = boundaryRun.length >= 2 ? "\n\n" : "\n";
  const prefix =
    before.length === 0 || before.endsWith(sep)
      ? ""
      : sep === "\n\n" && before.endsWith("\n")
        ? "\n"
        : sep;
  const suffix =
    after.length === 0 || after.startsWith(sep)
      ? ""
      : sep === "\n\n" && after.startsWith("\n")
        ? "\n"
        : sep;
  const insertedText = `${prefix}${trimmedText}${suffix}`;
  const nextDraft = `${before}${insertedText}${after}`;
  const start = before.length + prefix.length;
  return {
    nextDraft,
    insertedRange: { start, end: start + trimmedText.length },
  };
}

// Seamless variant of insertAsParagraph: blend the text into the existing
// paragraph (continuing the prose) instead of creating a new block. We join with
// a single space rather than a newline, and only when the boundary isn't already
// whitespace. The space is formatting placed OUTSIDE the exact bank-text span —
// the same way insertAsParagraph adds newlines — so the authorship guardrail
// still matches the verbatim text exactly.
function insertIntoParagraph(
  draft: string,
  insertionIndex: number,
  text: string,
  side: "start" | "end",
): { nextDraft: string; insertedRange: { start: number; end: number } } {
  const trimmedText = text.trim();
  const before = draft.slice(0, insertionIndex);
  const after = draft.slice(insertionIndex);
  const needsSpace = (boundaryChar: string | undefined): boolean =>
    boundaryChar !== undefined && boundaryChar !== "" && !/\s/.test(boundaryChar);

  let prefix = "";
  let suffix = "";
  if (side === "end") {
    // Append to the paragraph end: space between prose and the text.
    prefix = needsSpace(before[before.length - 1]) ? " " : "";
  } else {
    // Prepend to the paragraph start: space between the text and the prose.
    suffix = needsSpace(after[0]) ? " " : "";
  }

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
    case "into_paragraph": {
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

      const side = request.target.paragraphSide ?? "end";
      const insertionIndex =
        side === "start" ? paragraphRange.start : paragraphRange.end;
      const { nextDraft, insertedRange } = insertIntoParagraph(
        request.draft,
        insertionIndex,
        text,
        side,
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
