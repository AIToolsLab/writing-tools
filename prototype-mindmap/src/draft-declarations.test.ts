import { describe, expect, it } from "vitest";
import { detectDraftDeclarations } from "./draft-declarations";

describe("draft declaration detection", () => {
  it("detects explicit main-idea declarations with exact draft spans", () => {
    const draft =
      "Opening frame. The main idea is human control decides which ideas enter the draft. Then examples follow.";

    const declarations = detectDraftDeclarations(draft);

    expect(declarations).toEqual([
      expect.objectContaining({
        kind: "main_idea",
        text: "human control decides which ideas enter the draft",
        userPhrase: "The main idea is human control decides which ideas enter the draft",
        start: 15,
      }),
    ]);
  });

  it("detects thesis and argument declarations", () => {
    const draft =
      "My thesis: authorship depends on the user choosing the words.\nI am arguing that AI should reflect structure, not author it.";

    const declarations = detectDraftDeclarations(draft);

    expect(declarations.map((d) => ({ kind: d.kind, text: d.text }))).toEqual([
      { kind: "thesis", text: "authorship depends on the user choosing the words" },
      { kind: "argument", text: "AI should reflect structure, not author it" },
    ]);
  });

  it("handles transcript-style filler without requiring tidy prose", () => {
    const draft =
      "um okay so the core point is, the writer stays in charge of wording and placement. then I ramble a bit.";

    const declarations = detectDraftDeclarations(draft);

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      kind: "main_idea",
      text: "the writer stays in charge of wording and placement",
    });
  });

  it("detects a clearly repeated draft focus without treating it as structure", () => {
    const draft =
      "Human control decides what enters the draft. Some example material follows. Human control decides what enters the draft. A transition. Human control decides what enters the draft.";

    const declarations = detectDraftDeclarations(draft);

    expect(declarations).toEqual([
      expect.objectContaining({
        kind: "repeated_focus",
        text: "Human control decides what enters the draft",
        userPhrase: "Human control decides what enters the draft.",
        start: 0,
      }),
    ]);
  });

  it("does not treat a light echo as a repeated draft focus", () => {
    const draft =
      "Human control decides what enters the draft. Later, human control decides what enters the draft.";

    expect(detectDraftDeclarations(draft)).toEqual([]);
  });

  it("does not fire on tentative declarations", () => {
    const draft =
      "Maybe the main idea is AI helps me think through structure. I am still unsure.";

    expect(detectDraftDeclarations(draft)).toEqual([]);
  });

  it("does not fire on tentative declarations with punctuation before the marker", () => {
    const draft =
      "Maybe, my main idea is AI helps me think through structure.";

    expect(detectDraftDeclarations(draft)).toEqual([]);
  });

  it("does not fire on conversational hedges before declaration markers", () => {
    const drafts = [
      "I think my main idea is AI helps me think through structure.",
      "I guess the thesis is authorship depends on choosing the words.",
      "I'm leaning toward the argument that AI should reflect structure, not author it.",
      "For now, the main idea is authorship stays with the writer.",
      "At this point, my thesis is the user should choose the map wording.",
    ];

    for (const draft of drafts) {
      expect(detectDraftDeclarations(draft)).toEqual([]);
    }
  });

  it("does not fire when the declaration body is itself modal", () => {
    const drafts = [
      "The main idea is might be that control matters most.",
      "My thesis is could be that authorship depends on choosing the words.",
      "The argument is that might suggest AI should reflect structure, not author it.",
      "The main idea is it might be that control matters most.",
      "My thesis is that could mean authorship depends on choosing the words.",
      "The core point is this may suggest the writer should stay in charge.",
    ];

    for (const draft of drafts) {
      expect(detectDraftDeclarations(draft)).toEqual([]);
    }
  });

  it("does not fire on questions or plain mentions of main ideas", () => {
    const draft =
      "What is the main idea here? I need a main idea before the ending works.";

    expect(detectDraftDeclarations(draft)).toEqual([]);
  });

  it("requires a substantive body", () => {
    expect(detectDraftDeclarations("The thesis is control.")).toEqual([]);
  });
});
