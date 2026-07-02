// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CoachTrace, type TraceEvent } from "./CoachTrace";

// The derive-layer assertions live in trace.test.ts (coder 1 owns the catalog).
// These UI tests use hand-built events so they never depend on catalog copy.

// Every icon key the real catalog (trace.ts) can emit. Each must map to a real
// glyph in the panel — the raw-key fallback must never show to a user.
const CONTRACT_ICONS = [
  "check",
  "reflect",
  "pause",
  "sprout",
  "pace",
  "pin",
  "compass",
  "refresh",
  "chat",
  "help",
  "link",
  "pencil",
  "x",
  "target",
];

describe("CoachTrace panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  const events: TraceEvent[] = [
    {
      id: "trace-1",
      turnId: "1",
      reason: "stance:deepen",
      level: "quiet",
      icon: "chat",
      title: "Going deeper on one idea",
      explanation: "Looking more closely at what you just said, rather than moving on.",
      technical: { reason: "stance:deepen" },
    },
    {
      id: "trace-2",
      turnId: "2",
      reason: "validation_failed",
      level: "held",
      icon: "pause",
      title: "I held back a reflection",
      explanation: "I started to reflect, but the wording drifted too far from yours.",
      detail: "The draft reflection didn't match your source text closely enough. Grounding 0.42, needed 0.60.",
      technical: { reason: "validation_failed", check: "lexical_grounding", score: 0.42, threshold: 0.6 },
    },
  ];

  it("renders catalog copy but never the reason or raw JSON by default", () => {
    act(() => root.render(<CoachTrace events={events} defaultOpen />));

    const list = container.querySelector(".coach-trace-list");
    expect(list).not.toBeNull();
    const listText = list!.textContent ?? "";

    expect(listText).toContain("I held back a reflection");
    expect(listText).toContain("Going deeper on one idea");
    // Neither the internal reason key nor the raw JSON shows collapsed.
    expect(listText).not.toContain("validation_failed");
    expect(container.querySelector(".ct-technical")).toBeNull();
  });

  it("styles a held event calm (never an error) via the held chip", () => {
    act(() => root.render(<CoachTrace events={events} defaultOpen />));

    const heldRow = Array.from(container.querySelectorAll<HTMLButtonElement>(".ct-row")).find((row) =>
      row.textContent?.includes("I held back a reflection"),
    );
    expect(heldRow?.className).toContain("level-held");
    expect(heldRow?.querySelector(".ct-chip")?.className).toContain("kind-held");
  });

  it("reveals the score on expand and raw keys only behind the technical toggle", () => {
    act(() => root.render(<CoachTrace events={events} defaultOpen />));

    const heldRow = Array.from(container.querySelectorAll<HTMLButtonElement>(".ct-row")).find((row) =>
      row.textContent?.includes("I held back a reflection"),
    );
    expect(heldRow).toBeDefined();

    act(() => heldRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    // The grounding score (detail) is now visible; the reason key still is not.
    expect(container.querySelector(".ct-detail")?.textContent).toContain("0.42");
    expect(container.querySelector(".ct-technical")).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(".ct-technical-toggle");
    expect(toggle).not.toBeNull();

    act(() => toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const technical = container.querySelector(".ct-technical");
    expect(technical).not.toBeNull();
    // Raw keys appear ONLY here, on demand.
    expect(technical!.textContent).toContain("validation_failed");
    expect(technical!.textContent).toContain("threshold");
  });

  it("maps every contract icon to a real glyph (never a raw key)", () => {
    const iconEvents: TraceEvent[] = CONTRACT_ICONS.map((icon, i) => ({
      id: `trace-icon-${i}`,
      turnId: String(i),
      reason: "test",
      level: "notice",
      icon,
      title: `event ${icon}`,
      explanation: "why",
    }));

    act(() => root.render(<CoachTrace events={iconEvents} defaultOpen />));

    const chips = Array.from(container.querySelectorAll(".ct-chip"));
    expect(chips).toHaveLength(CONTRACT_ICONS.length);
    chips.forEach((chip, i) => {
      const glyph = chip.textContent ?? "";
      expect(glyph.length).toBeGreaterThan(0);
      // The raw catalog key must never reach the user as the glyph.
      expect(glyph).not.toBe(CONTRACT_ICONS[i]);
    });
  });

  it("shows an empty-state hint when there are no events", () => {
    act(() => root.render(<CoachTrace events={[]} defaultOpen />));

    expect(container.querySelector(".coach-trace-empty")).not.toBeNull();
  });
});
