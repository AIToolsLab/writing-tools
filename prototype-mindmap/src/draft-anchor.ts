const BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "SECTION", "LI", "UL", "OL",
]);

/** One source character, mapped back to its DOM text node (undefined for a
 *  synthetic block separator that exists only to break adjacent blocks apart). */
interface RawChar { node?: Text; offset?: number; ch: string; }

/**
 * Flatten the editor into characters, inserting a newline at block and `<br>`
 * boundaries so the DOM text lines up with the plain-text draft the model
 * anchors against (`draftHtmlToPlainText`). Without these breaks a
 * cross-paragraph anchor never matches, which quietly forces the model toward
 * short, single-block anchors.
 */
function collectRawChars(root: HTMLElement): RawChar[] {
  const out: RawChar[] = [];
  const pushBreak = () => { if (out.length && out[out.length - 1].ch !== "\n") out.push({ ch: "\n" }); };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      for (let i = 0; i < data.length; i++) out.push({ node: node as Text, offset: i, ch: data[i] });
      return;
    }
    if (!(node instanceof HTMLElement)) { node.childNodes.forEach(visit); return; }
    if (node.tagName === "BR") { out.push({ ch: "\n" }); return; }
    const isBlock = BLOCK_TAGS.has(node.tagName);
    if (isBlock) pushBreak();
    node.childNodes.forEach(visit);
    if (isBlock) pushBreak();
  };
  root.childNodes.forEach(visit);
  return out;
}

export function findDraftAnchorRange(root: HTMLElement, searchText: string): Range | undefined {
  const needle = searchText.replace(/\s+/g, " ").trim();
  if (!needle) return undefined;
  const raw = collectRawChars(root);

  // Whitespace-normalized haystack with a map from each normalized-string index
  // back to its source character, so block breaks and runs of spaces/newlines
  // never block a match while range endpoints still resolve to real text nodes.
  let hay = "";
  const map: number[] = [];
  let prevSpace = true; // drop leading whitespace
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i].ch)) {
      if (prevSpace) continue;
      hay += " "; map.push(i); prevSpace = true;
    } else {
      hay += raw[i].ch; map.push(i); prevSpace = false;
    }
  }
  if (hay.endsWith(" ")) { hay = hay.slice(0, -1); map.pop(); }

  const startHay = hay.indexOf(needle);
  if (startHay < 0) return undefined;
  const startRaw = raw[map[startHay]];
  const endRaw = raw[map[startHay + needle.length - 1]];
  // needle is trimmed, so its first/last chars are non-space and always map to
  // real text nodes; interior separators never become range endpoints.
  if (!startRaw?.node || !endRaw?.node || startRaw.offset == null || endRaw.offset == null) return undefined;
  const range = document.createRange();
  range.setStart(startRaw.node, startRaw.offset);
  range.setEnd(endRaw.node, endRaw.offset + 1);
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
