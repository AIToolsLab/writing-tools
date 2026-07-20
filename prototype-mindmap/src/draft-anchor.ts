export function findDraftAnchorRange(root: HTMLElement, searchText: string): Range | undefined {
  const needle = searchText.trim();
  if (!needle) return undefined;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let fullText = "";
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const node = current as Text;
    const start = fullText.length;
    fullText += node.data;
    textNodes.push({ node, start, end: fullText.length });
  }
  const start = fullText.indexOf(needle);
  if (start < 0) return undefined;
  const end = start + needle.length;
  const startNode = textNodes.find((entry) => start >= entry.start && start < entry.end);
  const endNode = textNodes.find((entry) => end > entry.start && end <= entry.end);
  if (!startNode || !endNode) return undefined;
  const range = document.createRange();
  range.setStart(startNode.node, start - startNode.start);
  range.setEnd(endNode.node, end - endNode.start);
  return range;
}

export interface DraftAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function measureDraftAnchorRects(root: HTMLElement, searchText: string): DraftAnchorRect[] {
  const range = findDraftAnchorRange(root, searchText);
  if (!range) return [];
  const rootRect = root.getBoundingClientRect();
  return Array.from(range.getClientRects()).map((rect) => ({
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
  }));
}

export function scrollDraftAnchorIntoView(root: HTMLElement, searchText: string): boolean {
  const range = findDraftAnchorRange(root, searchText);
  if (!range) return false;
  const rect = range.getBoundingClientRect();
  const editorRect = root.getBoundingClientRect();
  root.scrollTop += rect.top - editorRect.top - 24;
  return true;
}
