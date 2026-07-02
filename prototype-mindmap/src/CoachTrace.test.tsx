// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CoachTraceStatus, type TraceEvent } from "./CoachTrace";

// The derive-layer assertions live in trace.test.ts (coder 1 owns the catalog).
// These UI tests use hand-built events so they never depend on catalog copy.

// Every icon key the real catalog (trace.ts) can emit. Each must map to a real
// glyph — the raw-key fallback must never show to a user.
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

function event(overrides: Partial<TraceEvent> & Pick<TraceEvent, "id">): TraceEvent {
  return {
    turnId: overrides.id,
    reason: "stance:deepen",
    level: "quiet",
    icon: "chat",
    title: "Some title",
    explanation: "Some explanation.",
    ...overrides,
  };
}

const threeEvents: TraceEvent[] = [
  event({ id: "e1", title: "First decision", explanation: "The oldest one." }),
  event({ id: "e2", title: "Second decision", explanation: "The middle one." }),
  event({
    id: "e3",
    title: "I held back a reflection",
    explanation: "Latest — held back this turn.",
    level: "held",
    icon: "pause",
    reason: "validation_failed",
    detail: "Grounding 0.42, needed 0.60.",
    technical: { reason: "validation_failed", score: 0.42, threshold: 0.6 },
  }),
];

describe("CoachTraceStatus", () => {
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

  function openHistory() {
    const statusBtn = container.querySelector<HTMLButtonElement>("button.coach-trace-status");
    act(() => statusBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  it("shows only the latest event by default, not older history", () => {
    act(() => root.render(<CoachTraceStatus events={threeEvents} />));

    const wrapText = container.textContent ?? "";
    expect(wrapText).toContain("I held back a reflection");
    expect(wrapText).not.toContain("First decision");
    expect(wrapText).not.toContain("Second decision");
    // No history popover until the status is clicked.
    expect(container.querySelector(".coach-trace-popover")).toBeNull();
  });

  it("renders title and explanation as separate block elements (not jammed inline)", () => {
    act(() => root.render(<CoachTraceStatus events={threeEvents} />));

    const title = container.querySelector(".ct-status-title");
    const explanation = container.querySelector(".ct-status-explanation");
    expect(title).not.toBeNull();
    expect(explanation).not.toBeNull();
    expect(title).not.toBe(explanation);
    // The title node holds only the title — explanation copy is not fused into it.
    expect(title!.textContent).toBe("I held back a reflection");
    expect(title!.textContent).not.toContain("held back this turn");
  });

  it("keeps the compact status free of raw reason keys and JSON", () => {
    act(() => root.render(<CoachTraceStatus events={threeEvents} />));

    const wrapText = container.textContent ?? "";
    expect(wrapText).not.toContain("validation_failed");
    expect(wrapText).not.toContain("threshold");
  });

  it("styles a held latest event calm (never an error)", () => {
    act(() => root.render(<CoachTraceStatus events={threeEvents} />));

    const statusBtn = container.querySelector("button.coach-trace-status");
    expect(statusBtn?.className).toContain("level-held");
    expect(statusBtn?.querySelector(".ct-chip")?.className).toContain("kind-held");
  });

  it("opens the history on click, revealing older events", () => {
    act(() => root.render(<CoachTraceStatus events={threeEvents} />));
    openHistory();

    const popover = container.querySelector(".coach-trace-popover");
    expect(popover).not.toBeNull();
    const popoverText = popover!.textContent ?? "";
    expect(popoverText).toContain("First decision");
    expect(popoverText).toContain("Second decision");
    expect(popoverText).toContain("I held back a reflection");
  });

  it("keeps technical detail hidden in history until toggled", () => {
    act(() => root.render(<CoachTraceStatus events={threeEvents} />));
    openHistory();

    const heldRow = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".coach-trace-popover .ct-row"),
    ).find((row) => row.textContent?.includes("I held back a reflection"));
    expect(heldRow).toBeDefined();

    act(() => heldRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    // Detail (the score) is now visible; raw keys still are not.
    expect(container.querySelector(".ct-detail")?.textContent).toContain("0.42");
    expect(container.querySelector(".ct-technical")).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(".ct-technical-toggle");
    act(() => toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const technical = container.querySelector(".ct-technical");
    expect(technical).not.toBeNull();
    expect(technical!.textContent).toContain("validation_failed");
    expect(technical!.textContent).toContain("threshold");
  });

  it("maps every contract icon to a real glyph in the history (never a raw key)", () => {
    const iconEvents: TraceEvent[] = CONTRACT_ICONS.map((icon, i) =>
      event({ id: `icon-${i}`, icon, level: "notice", title: `event ${icon}` }),
    );
    act(() => root.render(<CoachTraceStatus events={iconEvents} />));
    openHistory();

    const chips = Array.from(container.querySelectorAll(".coach-trace-popover .ct-chip"));
    expect(chips).toHaveLength(CONTRACT_ICONS.length);
    // Popover renders newest-first, so reverse to line glyphs up with icon keys.
    const reversed = [...CONTRACT_ICONS].reverse();
    chips.forEach((chip, i) => {
      const glyph = chip.textContent ?? "";
      expect(glyph.length).toBeGreaterThan(0);
      expect(glyph).not.toBe(reversed[i]);
    });
  });

  it("shows a quiet placeholder and no button when there are no events", () => {
    act(() => root.render(<CoachTraceStatus events={[]} />));

    expect(container.querySelector(".coach-trace-status.placeholder")).not.toBeNull();
    expect(container.querySelector("button.coach-trace-status")).toBeNull();
    expect(container.textContent).toContain("will appear here");
  });
});
