// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveMirrorDecision, UnderTheHoodPanel } from "./App";
import type { UnderstandingSnapshot } from "./understanding";

describe("resolveMirrorDecision", () => {
  it("waits to continue until every claim in the mirror is confirmed", () => {
    const first = resolveMirrorDecision(
      {
        c1: "pending",
        c2: "pending",
      },
      "c1",
      "confirmed",
    );

    expect(first.allDecided).toBe(false);
    expect(first.shouldContinue).toBe(false);

    const second = resolveMirrorDecision(first.nextDecisions, "c2", "confirmed");

    expect(second.allDecided).toBe(true);
    expect(second.anyConfirmed).toBe(true);
    expect(second.anyDeclined).toBe(false);
    expect(second.shouldContinue).toBe(true);
  });

  it("prefers the repair path when any chunk in a completed mirror is declined", () => {
    const first = resolveMirrorDecision(
      {
        c1: "pending",
        c2: "pending",
      },
      "c1",
      "confirmed",
    );

    const second = resolveMirrorDecision(first.nextDecisions, "c2", "declined");

    expect(second.allDecided).toBe(true);
    expect(second.anyConfirmed).toBe(true);
    expect(second.anyDeclined).toBe(true);
    expect(second.shouldContinue).toBe(false);
  });
});

describe("UnderTheHoodPanel", () => {
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

  function snapshot(): UnderstandingSnapshot {
    return {
      banner: "Nothing here is on your map. This is what I'm considering.",
      latest: {
        id: "trace-1",
        turnId: "1",
        reason: "stance:deepen",
        level: "notice",
        icon: "help",
        title: "Asked you to clarify",
        explanation: "Something did not quite land.",
      },
      activeEvents: [
        {
          id: "ready",
          kind: "readiness_changed",
          stage: "checked",
          title: "Idea is ready to reflect",
          detail: "Enough user-owned wording has accumulated for a safe reflection.",
          evidence: "human control decides the final draft",
          state: "chosen",
          stateLabel: "ready",
          technicalDetail: ["grounded:100%"],
        },
      ],
      trackedIdeas: [
        {
          id: "candidate-1",
          label: "human control decides the final draft",
          target: "idea",
          status: "ready",
          meters: { grounded: 1, specific: 0.8, related: 1 },
          showRelated: false,
        },
      ],
      waitingFor: "the exact words you'd carry forward",
      safetyChecks: [{ id: "safe", label: "I won't change your map unless you ask me to.", state: "ok" }],
      draftAnchors: [{ label: "human control", anchor: "human control", kind: "main_idea" }],
    };
  }

  it("opens as a read-only under-the-hood rail and highlights draft anchors", () => {
    const onDraftAnchor = vi.fn();
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    act(() =>
      root.render(createElement(UnderTheHoodPanel, { snapshot: snapshot(), onDraftAnchor })),
    );

    expect(container.querySelector(".underhood-panel")).toBeNull();
    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    expect(tab).not.toBeNull();

    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.querySelector(".underhood-panel")).not.toBeNull();
    expect(container.textContent).toContain("Nothing here is on your map");
    expect(container.textContent).toContain("What mattered this turn");
    expect(container.textContent).toContain("Idea is ready to reflect");
    expect(container.textContent).toContain("checked");
    expect(container.textContent).toContain("human control decides the final draft");
    expect(container.textContent).toContain("ok");
    expect(container.querySelector(".anchor-button")).not.toBeNull();

    const detailButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".event-detail-toggle"))
      .find((button) => button.textContent === "Show detail");
    expect(detailButton).toBeTruthy();
    act(() => detailButton!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("grounded:100%");

    const anchor = container.querySelector<HTMLButtonElement>(".anchor-button");
    act(() => anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDraftAnchor).toHaveBeenCalledWith("human control");
    window.matchMedia = original;
  });

  it("uses the latest causal event as the closed tab label", () => {
    act(() =>
      root.render(createElement(UnderTheHoodPanel, { snapshot: snapshot(), onDraftAnchor: vi.fn() })),
    );

    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    expect(tab?.textContent).toContain("Idea is ready to reflect");
  });

  it("reveals path steps immediately when reduced motion is preferred", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    act(() =>
      root.render(createElement(UnderTheHoodPanel, { snapshot: snapshot(), onDraftAnchor: vi.fn() })),
    );

    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.querySelector(".event-row.revealed")).not.toBeNull();
    expect(container.textContent).toContain("ready");
    window.matchMedia = original;
  });

  it("renders older persisted events that do not have a stage field", () => {
    const legacy = snapshot();
    legacy.activeEvents = [
      {
        id: "legacy",
        kind: "idea_tracked",
        title: "Idea tracked",
        detail: "Older saved event.",
        state: "watching",
        stateLabel: "tracked",
      } as UnderstandingSnapshot["activeEvents"][number],
    ];
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    act(() =>
      root.render(createElement(UnderTheHoodPanel, { snapshot: legacy, onDraftAnchor: vi.fn() })),
    );

    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("Idea tracked");
    expect(container.textContent).toContain("tracked");
    expect(container.textContent).not.toContain("undefined");
    window.matchMedia = original;
  });
});
