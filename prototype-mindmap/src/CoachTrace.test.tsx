// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CoachTrace, deriveTraceEvent, type TraceEvent } from "./CoachTrace";
import type { TurnOutput } from "./controller";

function makeOut(partial: Partial<TurnOutput>): TurnOutput {
  return {
    mode: "question",
    text: "some coach text",
    llmTurn: { mode: "question", text: "some coach text" },
    ...partial,
  };
}

describe("deriveTraceEvent", () => {
  it("marks a suppressed reflection as held (not an error) and hides the reason from copy", () => {
    const event = deriveTraceEvent(
      makeOut({ suppressionReason: "not_ready", suppressionDetail: "grounding 0.42 < 0.60" }),
      "7",
    );

    expect(event.level).toBe("held");
    expect(event.turnId).toBe("7");
    expect(event.title).not.toMatch(/\.$/); // no trailing period
    // The internal reason key must never leak into user-facing copy.
    expect(event.title).not.toContain("not_ready");
    expect(event.explanation).not.toContain("not_ready");
    // The score lives in detail; raw keys live only in technical.
    expect(event.detail).toContain("0.42");
    expect(event.technical).toMatchObject({ suppressionReason: "not_ready" });
  });

  it("treats a command hand-back with map changes as an executed notice, not held", () => {
    const event = deriveTraceEvent(
      makeOut({
        suppressionReason: "command_precedence",
        mapCommands: [{ kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] }],
      }),
      "3",
    );

    expect(event.level).toBe("notice");
    expect(event.icon).toBe("check");
  });

  it("classifies a validated mirror as a reflected notice", () => {
    const event = deriveTraceEvent(
      makeOut({
        validatedMirror: { reflection: { claims: [] }, claims: [] } as TurnOutput["validatedMirror"],
      }),
      "1",
    );

    expect(event.level).toBe("notice");
    expect(event.icon).toBe("mirror");
  });

  it("classifies a plain question as an ambient quiet event", () => {
    const event = deriveTraceEvent(makeOut({ mode: "question" }), "2");

    expect(event.level).toBe("quiet");
  });
});

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
      id: "trace_1",
      turnId: "1",
      reason: "question",
      level: "quiet",
      icon: "ear",
      title: "Kept listening",
      explanation: "I asked a question to help you take the next small step.",
    },
    {
      id: "trace_2",
      turnId: "2",
      reason: "not_ready",
      level: "held",
      icon: "pause",
      title: "I held back a reflection",
      explanation: "I didn't have enough of your own words to mirror this cleanly yet.",
      detail: "Grounding score was 0.42, below the 0.60 bar.",
      technical: { suppressionReason: "not_ready", grounding: 0.42 },
    },
  ];

  it("renders catalog copy but never the reason or raw JSON by default", () => {
    act(() => root.render(<CoachTrace events={events} defaultOpen />));

    const list = container.querySelector(".coach-trace-list");
    expect(list).not.toBeNull();
    const listText = list!.textContent ?? "";

    expect(listText).toContain("I held back a reflection");
    expect(listText).toContain("Kept listening");
    // Neither the internal reason key nor the score/raw JSON shows collapsed.
    expect(listText).not.toContain("not_ready");
    expect(container.querySelector(".ct-technical")).toBeNull();
  });

  it("reveals detail on expand and raw keys only behind the technical toggle", () => {
    act(() => root.render(<CoachTrace events={events} defaultOpen />));

    const heldRow = Array.from(container.querySelectorAll<HTMLButtonElement>(".ct-row")).find(
      (row) => row.textContent?.includes("I held back a reflection"),
    );
    expect(heldRow).toBeDefined();

    act(() => heldRow!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    // Detail (plain English) is now visible; reason still is not.
    expect(container.querySelector(".ct-detail")?.textContent).toContain("0.42");
    expect(container.querySelector(".ct-technical")).toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(".ct-technical-toggle");
    expect(toggle).not.toBeNull();

    act(() => toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const technical = container.querySelector(".ct-technical");
    expect(technical).not.toBeNull();
    // Raw keys appear ONLY here, on demand.
    expect(technical!.textContent).toContain("not_ready");
    expect(technical!.textContent).toContain("{");
  });

  it("shows an empty-state hint when there are no events", () => {
    act(() => root.render(<CoachTrace events={[]} defaultOpen />));

    expect(container.querySelector(".coach-trace-empty")).not.toBeNull();
  });
});
