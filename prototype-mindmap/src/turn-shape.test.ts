import { describe, expect, it } from "vitest";
import { detectTurnShape } from "./turn-shape";
import type { SourceUtterance } from "./types";

function u(text: string, index: number): SourceUtterance {
  return {
    id: `u_${index}`,
    text,
    timestamp: 0,
    origin: "chat",
    turnId: "t_1",
  };
}

describe("turn shape detection", () => {
  it("keeps compact turns compact", () => {
    const units = [u("I want to understand the opening.", 1)];

    expect(detectTurnShape(units[0].text, units)).toEqual({
      kind: "compact",
      reasons: [],
      selected: false,
    });
  });

  it("classifies four or more sentence units as large exploratory", () => {
    const units = [
      u("First thought.", 1),
      u("Second thought.", 2),
      u("Third thought.", 3),
      u("Fourth thought.", 4),
    ];

    expect(detectTurnShape(units.map((unit) => unit.text).join(" "), units)).toMatchObject({
      kind: "large_exploratory",
      selected: false,
    });
  });

  it("classifies long unpunctuated voice-style text as large exploratory", () => {
    const text =
      "control authorship reflection agency trust structure wording placement evidence confirmation hierarchy connection drafting revision example pressure tension assumption reader claim thesis argument voice transcript selection priority focus contrast ownership validation pacing mapping question consequence context ending opening middle control authorship reflection agency trust structure wording placement evidence confirmation hierarchy connection";
    const units = [u(text, 1)];

    const shape = detectTurnShape(text, units);

    expect(shape.kind).toBe("large_exploratory");
    expect(shape.reasons.some((reason) => reason.startsWith("content_tokens:"))).toBe(true);
  });

  it("classifies long turns with explicit declarations as large selected", () => {
    const text =
      "I am thinking through examples and caveats before the ending lands. The main idea is human control decides what enters the draft. I also need to explain why reflection is different from authorship. The conclusion should probably return to the map.";
    const units = [
      u("I am thinking through examples and caveats before the ending lands.", 1),
      u("The main idea is human control decides what enters the draft.", 2),
      u("I also need to explain why reflection is different from authorship.", 3),
      u("The conclusion should probably return to the map.", 4),
    ];

    expect(detectTurnShape(text, units)).toMatchObject({
      kind: "large_selected",
      selected: true,
    });
  });

  it("classifies direct command phrasing in a long turn as selected without executing it", () => {
    const text =
      "There is a lot here and I am still narrating the setup. Put human control on the map. The rest is me testing the ending and thinking about examples. I may still change the frame.";
    const units = [
      u("There is a lot here and I am still narrating the setup.", 1),
      u("Put human control on the map.", 2),
      u("The rest is me testing the ending and thinking about examples.", 3),
      u("I may still change the frame.", 4),
    ];

    expect(detectTurnShape(text, units)).toMatchObject({
      kind: "large_selected",
      selected: true,
    });
  });
});
