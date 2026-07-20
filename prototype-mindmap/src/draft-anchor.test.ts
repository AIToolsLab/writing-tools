// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { findDraftAnchorRange, measureDraftAnchorRects } from "./draft-anchor";

describe("passive draft anchors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it("finds an exact passage across rich-text inline nodes", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<p>Those <strong>classes probably</strong> did matter.</p>";
    expect(findDraftAnchorRange(editor, "Those classes probably did matter.")?.toString()).toBe("Those classes probably did matter.");
    expect(findDraftAnchorRange(editor, "classes did matter")).toBeUndefined();
  });

  it("measures a passive overlay without changing the user's native selection", () => {
    const selected = document.createTextNode("user-selected text");
    const editor = document.createElement("div");
    editor.textContent = "A model-chosen passage remains passive.";
    document.body.append(selected, editor);
    const userRange = document.createRange();
    userRange.selectNodeContents(selected);
    window.getSelection()?.addRange(userRange);
    const anchorRange = findDraftAnchorRange(editor, "model-chosen passage")!;
    Object.defineProperty(anchorRange, "getClientRects", { value: () => [{ left: 15, top: 25, width: 120, height: 18 }] as unknown as DOMRectList });
    vi.spyOn(editor, "getBoundingClientRect").mockReturnValue({ left: 5, top: 10 } as DOMRect);
    vi.spyOn(document, "createRange").mockReturnValueOnce(anchorRange);

    expect(measureDraftAnchorRects(editor, "model-chosen passage")).toEqual([{ left: 10, top: 15, width: 120, height: 18 }]);
    expect(window.getSelection()?.toString()).toBe("user-selected text");
  });
});
