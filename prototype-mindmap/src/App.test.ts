// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantResponseKindBadge, buildConversationHistory, deriveCurrentUserTurn, draftHtmlToPlainText, InfluenceBadge, MapActionProposalCard, migrateCandidateMemory, migrateLegacyMirrors, migrateStoredProposals, normalizeDraftPasteHtml, resolveMirrorDecision, TURN_PROGRESS_COPY } from "./App";
import { UnderTheHoodPanel } from "./ControlRoom";
import { ASSISTANCE_CONTRACTS, snapshotContract } from "./assistance-contract";
import { ThoughtUnitStore } from "./map-store";
import type { Proposal } from "./proposal-store";
import { createConversationState } from "./stage1-loop";
import type { UnderstandingSnapshot } from "./understanding";
import { MutationPolicyProvider } from "./mutation-policy";
import { UiLocaleProvider } from "./ui-locale";

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

describe("session migration", () => {
  it("invalidates unresolved legacy pending mirrors instead of granting current-contract provenance", () => {
    const migrated = migrateLegacyMirrors([{ id: "m1", reflection: { claims: [{ id: "c1", text: "human control", candidateId: "candidate", target: "idea", sourceSpans: [] }] }, claims: [], decisions: { c1: "pending" } }], 7);
    expect(migrated).toMatchObject([{ id: "m1", mapRevision: 7, state: "invalidated", origin: "unresolved", detail: { kind: "reflection", editedTexts: { c1: "human control" } } }]);
  });
});

describe("application recovery history", () => {
  it("uses plain-language copy for each real recovery stage", () => {
    expect(TURN_PROGRESS_COPY).toEqual({
      grounding_repair: "Making sure this stays in your words...",
      forced_question: "Asking a focused question instead...",
    });
  });

  it("excludes terminal recovery UI from provider dialogue history", () => {
    expect(buildConversationHistory([
      { id: 1, role: "user", text: "human control matters" },
      { id: 2, role: "application", text: "I couldn’t complete that response reliably.", terminal: "repair_failed" },
      { id: 3, role: "assistant", text: "What matters about control?" },
    ])).toEqual([
      { role: "user", content: "human control matters" },
      { role: "assistant", content: "What matters about control?" },
    ]);
  });

  it("retains an AI translation as assistant output without replacing its original user passage", () => {
    expect(buildConversationHistory([
      { id: 1, role: "user", text: "人类控制" },
      { id: 2, role: "assistant", text: "human control", responseKind: "translation" },
      { id: 3, role: "user", text: "How does that fit here?" },
    ])).toEqual([
      { role: "user", content: "人类控制" },
      { role: "assistant", content: "human control" },
      { role: "user", content: "How does that fit here?" },
    ]);
  });

  it("migrates legacy candidates to fresh active memory and preserves known dismissals", () => {
    expect(deriveCurrentUserTurn([{ turnId: "t_2" }, { turnId: "t_7" }, {}])).toBe(7);
    const migrated = migrateCandidateMemory([{
      id: "candidate",
      target: "idea",
      gist: "internal",
      evidenceUtteranceIds: ["u_1"],
    } as never], 7, ["candidate"]);
    expect(migrated).toMatchObject([{ id: "candidate", status: "ignored", createdTurn: 7, lastTouchedTurn: 7, ignoredAtTurn: 7 }]);
  });
});

describe("proposal UI", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT; });

  it("renders inline completion controls and requires an explicit decision click", () => {
    const onDecide = vi.fn();
    const proposal = { id: "p1", mapRevision: 1, referencedCardIds: [], attribution: "asserted" as const, state: "shown" as const, detail: { kind: "map_action" as const, action: { kind: "connect_cards" as const, source: {}, target: {} }, needsInput: ["source" as const, "target" as const, "label" as const] } };
    act(() => root.render(createElement(MapActionProposalCard, { proposal, cards: [], onEdit: vi.fn(), onDecide })));
    expect(container.querySelectorAll("select")).toHaveLength(2);
    const confirm = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Confirm");
    expect(confirm?.disabled).toBe(true);
    act(() => confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("shows invalidation feedback instead of executable controls", () => {
    const proposal = { id: "p1", mapRevision: 1, referencedCardIds: [], attribution: "asserted" as const, state: "invalidated" as const, invalidReason: "Card no longer exists.", detail: { kind: "map_action" as const, action: { kind: "create_card" as const, text: "x", sourceUtteranceIds: [] } } };
    act(() => root.render(createElement(MapActionProposalCard, { proposal, cards: [], onEdit: vi.fn(), onDecide: vi.fn() })));
    expect(container.textContent).toContain("Card no longer exists");
    expect(container.querySelector("button")).toBeNull();
  });

  it("marks AI suggestions and source-backed recaps while omitting unavailable legacy echo percentages", () => {
    act(() => root.render(createElement("div", undefined,
      createElement(AssistantResponseKindBadge, { kind: "suggestion" }),
      createElement(AssistantResponseKindBadge, { kind: "translation" }),
      createElement(AssistantResponseKindBadge, { kind: "grounded_recap" }),
      createElement(InfluenceBadge, { influence: { exactOverlapPhrases: ["human control"] } }),
    )));
    expect(container.textContent).toContain("AI suggestion");
    expect(container.textContent).toContain("AI-translated");
    expect(container.textContent).toContain("recap from your words");
    expect(container.textContent).toContain("Echoes coach");
    expect(container.textContent).not.toContain("NaN");
  });

  it("keeps a v4 echo trace but removes its unavailable pre-percentage value", () => {
    const proposal = {
      id: "v4-proposal",
      mapRevision: 1,
      referencedCardIds: [],
      origin: "user_asserted",
      contract: snapshotContract(ASSISTANCE_CONTRACTS[0]),
      state: "confirmed",
      influenceTrace: { priorAssistantMessageId: 2, exactOverlapPhrases: ["human control"] },
      detail: { kind: "map_action", action: { kind: "create_card", text: "human control", sourceUtteranceIds: [] } },
    } as Proposal;
    const state = createConversationState();
    const migrated = migrateStoredProposals([proposal], state.bank, new ThoughtUnitStore());
    expect(migrated[0]?.influenceTrace).toEqual({ priorAssistantMessageId: 2, exactOverlapPhrases: ["human control"], overlapRatio: undefined });
  });

  it("localizes proposal chrome without translating authored proposal text", () => {
    const proposal = {
      id: "localized-proposal",
      mapRevision: 1,
      referencedCardIds: [],
      origin: "user_asserted" as const,
      contract: snapshotContract(ASSISTANCE_CONTRACTS[0]),
      state: "shown" as const,
      detail: {
        kind: "map_action" as const,
        action: { kind: "create_card" as const, text: "Clear map", sourceUtteranceIds: ["u1"] },
      },
    };
    act(() => root.render(
      createElement(
        UiLocaleProvider,
        { initialLocale: "zh" },
        createElement(
          MutationPolicyProvider,
          { mode: "translated_view" },
          createElement(MapActionProposalCard, {
            proposal,
            cards: [],
            onEdit: vi.fn(),
            onDecide: vi.fn(),
          }),
        ),
      ),
    ));
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Clear map");
    expect(Array.from(container.querySelectorAll("button")).every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain("确认");
  });
});

describe("rich draft paste helpers", () => {
  it("preserves rich-text paragraphs and bold formatting in draft HTML", () => {
    expect(
      normalizeDraftPasteHtml(
        "First paragraph\nSecond paragraph",
        "<p><strong>First</strong> paragraph</p><p>Second paragraph</p>",
      ),
    ).toBe("<p><strong>First</strong> paragraph</p><p>Second paragraph</p>");
  });

  it("preserves pasted lists in draft HTML", () => {
    expect(
      normalizeDraftPasteHtml("- First\n- Second", "<ul><li><b>First</b></li><li>Second</li></ul>"),
    ).toBe("<ul><li><strong>First</strong></li><li>Second</li></ul>");
  });

  it("preserves multiple nested list levels from clipboard HTML", () => {
    expect(
      normalizeDraftPasteHtml(
        "",
        "<ul><li>One</li><ul><li>Two</li><ul><li>Three</li></ul></ul><li>Back</li></ul>",
      ),
    ).toBe("<ul><li>One<ul><li>Two<ul><li>Three</li></ul></li></ul></li><li>Back</li></ul>");
  });

  it("does not let block-level bold wrappers make the whole draft bold", () => {
    expect(
      normalizeDraftPasteHtml(
        "",
        '<b><p>Normal paragraph</p><p><span style="font-weight:700">Bold phrase</span> only</p></b>',
      ),
    ).toBe("<p>Normal paragraph</p><p><strong>Bold phrase</strong> only</p>");
  });

  it("converts rich draft HTML back to plain text for model context", () => {
    expect(
      draftHtmlToPlainText("<p><strong>First</strong> paragraph</p><ul><li>One</li><li>Two</li></ul>"),
    ).toBe("First paragraph\n\n- One\n- Two");
  });

  it("adds paragraph spacing for plain text pasted as single-line paragraphs", () => {
    expect(draftHtmlToPlainText(normalizeDraftPasteHtml("First paragraph\nSecond paragraph"))).toBe(
      "First paragraph\n\nSecond paragraph",
    );
  });

  it("keeps existing blank paragraph spacing in plain text", () => {
    expect(draftHtmlToPlainText(normalizeDraftPasteHtml("First paragraph\n\nSecond paragraph"))).toBe(
      "First paragraph\n\nSecond paragraph",
    );
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
          status: "active",
          evidenceCount: 1,
          ageInTurns: 0,
        },
      ],
      ignoredIdeas: [],
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
    expect(container.textContent).not.toContain("I won't change your map unless you ask me to.");
    expect(container.querySelector(".anchor-button")).toBeNull();

    const detailButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".event-detail-toggle"))
      .find((button) => button.textContent === "Show detail");
    expect(detailButton).toBeTruthy();
    act(() => detailButton!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("grounded:100%");

    const draftAnchorsHeader = Array.from(container.querySelectorAll<HTMLButtonElement>(".underhood-section-title"))
      .find((button) => button.textContent?.includes("Draft anchors"));
    expect(draftAnchorsHeader).toBeTruthy();
    act(() => draftAnchorsHeader!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.querySelector(".anchor-button")).not.toBeNull();

    const anchor = container.querySelector<HTMLButtonElement>(".anchor-button");
    act(() => anchor!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDraftAnchor).toHaveBeenCalledWith("human control");
    window.matchMedia = original;
  });

  it("lets tracked ideas be dismissed from Under the Hood", () => {
    const onDismissIdea = vi.fn();
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    act(() =>
      root.render(
        createElement(UnderTheHoodPanel, {
          snapshot: snapshot(),
          onDraftAnchor: vi.fn(),
          onDismissIdea,
        }),
      ),
    );

    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const dismiss = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Dismiss");
    expect(dismiss).toBeTruthy();
    act(() => dismiss!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onDismissIdea).toHaveBeenCalledWith("candidate-1");
    window.matchMedia = original;
  });

  it("keeps ignored ideas collapsed and restores them only through an explicit action", () => {
    const ignored = snapshot();
    ignored.trackedIdeas = [];
    ignored.ignoredIdeas = [{ id: "ignored-1", label: "transparency can become surveillance", target: "idea", status: "ignored", evidenceCount: 1, ageInTurns: 0 }];
    const onRestoreIdea = vi.fn();
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    act(() => root.render(createElement(UnderTheHoodPanel, { snapshot: ignored, onDraftAnchor: vi.fn(), onRestoreIdea })));
    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).not.toContain("transparency can become surveillance");
    const ignoredHeader = Array.from(container.querySelectorAll<HTMLButtonElement>(".underhood-section-title")).find((button) => button.textContent?.includes("Ignored ideas"));
    act(() => ignoredHeader!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const restore = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Restore");
    act(() => restore!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRestoreIdea).toHaveBeenCalledWith("ignored-1");
    window.matchMedia = original;
  });

  it("uses the latest causal event as the closed tab label", () => {
    act(() =>
      root.render(createElement(UnderTheHoodPanel, { snapshot: snapshot(), onDraftAnchor: vi.fn() })),
    );

    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    expect(tab?.textContent).toContain("Idea is ready to reflect");
  });

  it("can be controlled by an external toggle", () => {
    const onOpenChange = vi.fn();
    act(() =>
      root.render(
        createElement(UnderTheHoodPanel, {
          snapshot: snapshot(),
          onDraftAnchor: vi.fn(),
          open: false,
          onOpenChange,
        }),
      ),
    );

    expect(container.querySelector(".underhood-panel")).toBeNull();
    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    act(() =>
      root.render(
        createElement(UnderTheHoodPanel, {
          snapshot: snapshot(),
          onDraftAnchor: vi.fn(),
          open: true,
          onOpenChange,
        }),
      ),
    );

    expect(container.querySelector(".underhood-panel")).not.toBeNull();
    const close = container.querySelector<HTMLButtonElement>(".underhood-close");
    act(() => close!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onOpenChange).toHaveBeenCalledWith(false);
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

  it("collapses under-the-hood sections without losing their headers", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    act(() =>
      root.render(createElement(UnderTheHoodPanel, { snapshot: snapshot(), onDraftAnchor: vi.fn() })),
    );

    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const matteredHeader = Array.from(container.querySelectorAll<HTMLButtonElement>(".underhood-section-title"))
      .find((button) => button.textContent?.includes("What mattered this turn"));
    expect(matteredHeader).toBeTruthy();
    expect(container.textContent).toContain("Idea is ready to reflect");

    act(() => matteredHeader!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("What mattered this turn");
    expect(container.textContent).not.toContain("Idea is ready to reflect");
    window.matchMedia = original;
  });

  it("collapses a long tracked-ideas section by default", () => {
    const manyIdeas = snapshot();
    manyIdeas.trackedIdeas = [0, 1, 2, 3].map((index) => ({
      id: `candidate-${index}`,
      label: `tracked idea ${index}`,
      target: "idea" as const,
      status: "parked" as const,
      evidenceCount: 1,
      ageInTurns: 2,
    }));
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    act(() =>
      root.render(createElement(UnderTheHoodPanel, { snapshot: manyIdeas, onDraftAnchor: vi.fn() })),
    );

    const tab = container.querySelector<HTMLButtonElement>(".underhood-tab");
    act(() => tab!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("Ideas I'm tracking");
    expect(container.textContent).not.toContain("tracked idea 0");
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
