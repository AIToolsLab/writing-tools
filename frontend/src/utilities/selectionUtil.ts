/**
 * Retrieves text that includes content before the cursor, the selected text, and completes
 * the current word if it's truncated by the selection.
 *
 * @param docContext - The document context containing text before cursor, selected text, and text after cursor
 * @returns A string concatenating the text before cursor, selected text, and the first word from text after cursor
 */
export function getBefore(docContext: DocContext): string {
  const { contextData, beforeCursor, selectedText, afterCursor } = docContext;

  const joinedContextData = contextData ?
    contextData.map((section) => `## ${section.title}\n\n${section.content}\n\n`).join('') + '\n\n---\n\n' :
    '';

  // Complete the word if the end of the last word is not complete
  // treat both space and \r as word separators
  const completeWord = afterCursor.split(/[ \r]/, 1)[0];
  return joinedContextData + beforeCursor + selectedText + completeWord;
}

/**
 * Extracts paragraphs from document text and identifies the paragraph at the current cursor position.
 *
 * @param docContext - The document context containing text before cursor, selected text, and text after cursor
 * @returns An object containing an array of paragraph texts and the index of the paragraph where the cursor is positioned
 */
export function getCurParagraph(docContext: DocContext): { paragraphTexts: string[]; curParagraphIndex: number } {
  const { beforeCursor, selectedText, afterCursor } = docContext;

  // Get the entire text
  const allText = beforeCursor + selectedText + afterCursor;

  // Split the text by paragraph
  const paragraphTexts = allText.split('\r');

  // Count the number of paragraph separators (\r) in the beforeCursor
  // This directly gives us the paragraph index
  const curParagraphIndex = (beforeCursor.match(/\r/g) || []).length;

  return { paragraphTexts, curParagraphIndex };
}
