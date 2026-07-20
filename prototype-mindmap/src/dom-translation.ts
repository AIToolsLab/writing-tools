/**
 * Whole-page read-only translation.
 *
 * Interface copy lives as hundreds of literals spread across the app, so it is
 * translated where it ends up rather than at each call site: this walks the
 * rendered DOM, translates every visible string, and re-applies after React
 * re-renders (React rewrites text nodes it owns, which would otherwise undo the
 * translation on the next state change).
 *
 * Card text is the one exception — it lives in a textarea's `value` property
 * rather than in a text node, so those are translated in the component itself.
 */

import { useEffect, useRef } from "react";
import { translateStrings } from "./translate";

/** Elements whose text is markup or writer-owned input, never UI copy. */
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION"]);

/** Attributes that carry user-visible copy. */
const TEXT_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

interface AttributeTarget {
  element: Element;
  attribute: string;
}

function isTranslatable(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Punctuation, arrows, counts and other glyphs carry no language.
  return /\p{L}{2}/u.test(trimmed);
}

function collectTextNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIPPED_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-no-translate]")) return NodeFilter.FILTER_REJECT;
      return isTranslatable(node.nodeValue ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function collectAttributeTargets(root: Element): AttributeTarget[] {
  const targets: AttributeTarget[] = [];
  for (const attribute of TEXT_ATTRIBUTES) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      if (element.closest("[data-no-translate]")) continue;
      const value = element.getAttribute(attribute) ?? "";
      if (isTranslatable(value)) targets.push({ element, attribute });
    }
  }
  return targets;
}

/**
 * Translate everything rendered under `root` while `active` is true, and put the
 * original copy back when it is turned off.
 */
export function useFullPageTranslation({
  root,
  active,
  target,
  onError,
  onBusyChange,
}: {
  root: () => Element | null;
  active: boolean;
  target: string;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}): void {
  // Original copy, so the page can be restored exactly rather than
  // re-translated back — a round trip would not return the writer's wording.
  const textOriginals = useRef(new Map<Text, string>());
  const attributeOriginals = useRef(new Map<string, string>());
  const cache = useRef(new Map<string, string>());

  useEffect(() => {
    const texts = textOriginals.current;
    const attributes = attributeOriginals.current;

    function restore() {
      for (const [node, original] of texts) node.nodeValue = original;
      texts.clear();
      for (const [key, original] of attributes) {
        const [attribute, ...rest] = key.split("|");
        const element = document.querySelector(`[data-i18n-id="${rest.join("|")}"]`);
        element?.setAttribute(attribute, original);
      }
      attributes.clear();
    }

    if (!active) {
      restore();
      cache.current.clear();
      return;
    }

    let cancelled = false;
    let scheduled = 0;

    /** Put known translations on screen; return whatever is still missing. */
    function apply(): { visible: string[]; offscreen: string[] } {
      const element = root();
      if (!element) return { visible: [], offscreen: [] };
      const missing = new Set<string>();
      const visible = new Set<string>();

      for (const node of collectTextNodes(element)) {
        const original = texts.get(node) ?? node.nodeValue ?? "";
        if (!texts.has(node)) texts.set(node, original);
        const key = original.trim();
        const translated = cache.current.get(key);
        if (translated === undefined) {
          missing.add(key);
          // Text the reader is looking at right now goes in the first batch; a
          // closed panel or a scrolled-away message can wait its turn.
          const box = node.parentElement?.getBoundingClientRect();
          if (box && box.bottom > 0 && box.top < window.innerHeight && box.width > 0) {
            visible.add(key);
          }
          continue;
        }
        // Preserve the original leading/trailing spacing so inline text does
        // not run together with adjacent elements.
        const leading = original.match(/^\s*/)?.[0] ?? "";
        const trailing = original.match(/\s*$/)?.[0] ?? "";
        const next = `${leading}${translated}${trailing}`;
        if (node.nodeValue !== next) node.nodeValue = next;
      }

      for (const { element: node, attribute } of collectAttributeTargets(element)) {
        const current = node.getAttribute(attribute) ?? "";
        let id = node.getAttribute("data-i18n-id");
        if (!id) {
          id = Math.random().toString(36).slice(2);
          node.setAttribute("data-i18n-id", id);
        }
        const key = `${attribute}|${id}`;
        const original = attributes.get(key) ?? current;
        if (!attributes.has(key)) attributes.set(key, original);
        const translated = cache.current.get(original.trim());
        if (translated === undefined) missing.add(original.trim());
        else if (current !== translated) node.setAttribute(attribute, translated);
      }

      return {
        visible: Array.from(visible),
        offscreen: Array.from(missing).filter((text) => !visible.has(text)),
      };
    }

    async function flush() {
      const { visible, offscreen } = apply();
      if (cancelled || (visible.length === 0 && offscreen.length === 0)) {
        onBusyChange(false);
        return;
      }
      onBusyChange(true);
      function absorb(entries: Array<[string, string]>) {
        if (cancelled) return;
        for (const [original, translated] of entries) {
          cache.current.set(original, translated);
        }
        apply();
      }
      try {
        // On-screen text first, so the page stops looking half-translated while
        // long off-screen passages are still in flight.
        if (visible.length > 0) await translateStrings(visible, target, absorb);
        if (!cancelled && offscreen.length > 0) {
          await translateStrings(offscreen, target, absorb);
        }
      } catch (error) {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "Translation failed.");
        }
      } finally {
        if (!cancelled) onBusyChange(false);
      }
    }

    // Each landed batch mutates the DOM and re-fires the observer, so a single
    // frame is too eager — passes would keep interrupting each other. Let the
    // burst settle first.
    function schedule() {
      if (cancelled) return;
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(() => {
        scheduled = 0;
        void flush();
      }, 200);
    }

    void flush();

    // React rewrites the text nodes it owns on every re-render, so the
    // translation has to be re-applied whenever the tree changes.
    const observer = new MutationObserver(schedule);
    const element = root();
    if (element) {
      observer.observe(element, { subtree: true, childList: true, characterData: true });
    }

    return () => {
      cancelled = true;
      if (scheduled) window.clearTimeout(scheduled);
      observer.disconnect();
      restore();
    };
  }, [active, target, root, onError, onBusyChange]);
}
