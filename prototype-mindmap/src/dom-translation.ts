/**
 * Interface copy, rendered in the language the page is being shown in.
 *
 * The app renders hundreds of English literals, so rather than rewriting every
 * call site this walks the rendered DOM and swaps each one for its entry in the
 * checked-in dictionary (see ./ui-strings.ts). It re-applies after React
 * re-renders, which rewrite the text nodes React owns.
 *
 * Every lookup is synchronous and offline: interface copy NEVER reaches the
 * translation engine, so changing the write or the view language re-skins the
 * page instantly and for free. Copy with no dictionary entry stays in English.
 *
 * Card text is the one exception — it lives in a textarea's `value` property
 * rather than in a text node, and it is writer content, so it goes through the
 * engine in the component itself.
 */

import { useEffect, useRef } from "react";
import { noteMissingUiString, uiString } from "./ui-strings";

/** Elements whose text is markup or writer-owned input, never interface copy. */
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "OPTION"]);

/** Attributes that carry user-visible copy. */
const TEXT_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

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

/**
 * Render the interface under `root` in `target` while `active` is true, and put
 * the English copy back when it is turned off.
 */
export function useInterfaceLanguage({
  root,
  active,
  target,
}: {
  root: () => Element | null;
  active: boolean;
  target: string;
}): void {
  // The English copy, so the page is restored exactly rather than translated
  // back — a round trip would not return the original wording.
  const textOriginals = useRef(new Map<Text, string>());
  const attributeOriginals = useRef(new Map<string, string>());

  useEffect(() => {
    const texts = textOriginals.current;
    const attributes = attributeOriginals.current;

    function restore() {
      for (const [node, original] of texts) node.nodeValue = original;
      texts.clear();
      for (const [key, original] of attributes) {
        const [attribute, ...rest] = key.split("|");
        document
          .querySelector(`[data-i18n-id="${rest.join("|")}"]`)
          ?.setAttribute(attribute, original);
      }
      attributes.clear();
    }

    // Restoring first means a language switch starts from the English copy
    // rather than from the previous language's words.
    restore();
    if (!active) return;

    let scheduled = 0;
    let observer: MutationObserver | null = null;

    function apply() {
      const element = root();
      if (!element) return;

      for (const node of collectTextNodes(element)) {
        const original = texts.get(node) ?? node.nodeValue ?? "";
        const translated = uiString(original, target);
        // Anything without a dictionary entry is not interface copy — it is the
        // writer's content, which the engine renders. Touching it here would
        // overwrite that translation with the original on the next re-render.
        if (translated === undefined) {
          noteMissingUiString(original);
          continue;
        }
        if (!texts.has(node)) texts.set(node, original);
        // Preserve the original leading/trailing spacing so inline text does
        // not run together with adjacent elements.
        const leading = original.match(/^\s*/)?.[0] ?? "";
        const trailing = original.match(/\s*$/)?.[0] ?? "";
        const next = `${leading}${translated}${trailing}`;
        if (node.nodeValue !== next) node.nodeValue = next;
      }

      for (const attribute of TEXT_ATTRIBUTES) {
        for (const node of element.querySelectorAll(`[${attribute}]`)) {
          if (node.closest("[data-no-translate]")) continue;
          const current = node.getAttribute(attribute) ?? "";
          if (!isTranslatable(current)) continue;
          const id = node.getAttribute("data-i18n-id");
          const key = id ? `${attribute}|${id}` : undefined;
          const original = (key && attributes.get(key)) || current;
          const next = uiString(original, target);
          if (next === undefined) continue;
          if (!key) {
            const fresh = Math.random().toString(36).slice(2);
            node.setAttribute("data-i18n-id", fresh);
            attributes.set(`${attribute}|${fresh}`, original);
          } else if (!attributes.has(key)) {
            attributes.set(key, original);
          }
          if (current !== next) node.setAttribute(attribute, next);
        }
      }
    }

    /**
     * Apply without the observer hearing our own writes, which would otherwise
     * schedule a fresh pass for every swap we just made.
     */
    function applyQuietly() {
      observer?.disconnect();
      try {
        apply();
      } finally {
        const element = root();
        if (observer && element) {
          observer.observe(element, { subtree: true, childList: true, characterData: true });
        }
      }
    }

    // React rewrites its own text nodes on re-render, so re-apply on tree
    // changes. A little debounce lets a burst of them settle first.
    function schedule() {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(() => {
        scheduled = 0;
        applyQuietly();
      }, 50);
    }

    observer = new MutationObserver(schedule);
    applyQuietly();

    return () => {
      if (scheduled) window.clearTimeout(scheduled);
      observer?.disconnect();
      observer = null;
      restore();
    };
  }, [active, target, root]);
}
