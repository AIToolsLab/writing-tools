import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config";
import type { MirrorClaim, SourceUtterance } from "./types";
import { validateMirror } from "./validator";

let n = 0;
function u(text: string, origin: SourceUtterance["origin"] = "chat"): SourceUtterance {
  n += 1;
  return { id: `u${n}`, text, timestamp: n, origin };
}

function claim(
  text: string,
  spans: MirrorClaim["sourceSpans"],
  target: MirrorClaim["target"] = "idea",
): MirrorClaim {
  return { id: `c-${text.slice(0, 8)}`, text, candidateId: "cand", target, sourceSpans: spans };
}

function checkOf(
  claimResult: {
    checks: {
      check: string;
      ok: boolean;
      parts?: { name: string; ok: boolean }[];
    }[];
  },
  name: string,
) {
  return claimResult.checks.find((c) => c.check === name);
}

function partOf(
  check: { parts?: { name: string; ok: boolean }[] } | undefined,
  name: string,
) {
  return check?.parts?.find((p) => p.name === name);
}

describe("mirror validator — 3 checks", () => {
  it("passes a reflection made of the user's own words, lightly rearranged", () => {
    const bank = [
      u("the questioning comes before anything else"),
      u("you ask me questions before you show a visualization"),
    ];
    const reflection = {
      claims: [
        claim(
          "the questioning is what comes before the visualization",
          [
            {
              claimText: "questioning comes before",
              utteranceIds: [bank[0].id],
              userPhrase: "questioning comes before",
            },
            {
              claimText: "before the visualization",
              utteranceIds: [bank[1].id],
              userPhrase: "before you show a visualization",
            },
          ],
        ),
      ],
    };

    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(true);
  });

  it("accepts word variants via stemming (organizing ~ organize)", () => {
    const bank = [u("i keep organizing my ideas into groups")];
    const reflection = {
      claims: [
        claim("you organize your ideas into groups", [
          {
            claimText: "organize ideas into groups",
            utteranceIds: [bank[0].id],
            userPhrase: "organizing my ideas into groups",
          },
        ]),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(true);
  });

  it("Check 1: blocks vocabulary drift (AI's own words)", () => {
    const bank = [u("i felt nervous walking across campus")];
    const reflection = {
      claims: [
        claim("this transformed your sense of belonging", [
          {
            claimText: "transformed your sense of belonging",
            utteranceIds: [bank[0].id],
            userPhrase: "felt nervous walking across campus",
          },
        ]),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    const lexical = checkOf(result.claims[0], "lexical_grounding");
    expect(lexical?.ok).toBe(false);
    expect(partOf(lexical, "broad_overlap")?.ok).toBe(false);
  });

  it("Check 2: blocks a NEW relationship built from real user words", () => {
    // Every content word exists in the bank, but the user never linked
    // questioning to confirmation. The relationship is the AI's invention.
    const bank = [
      u("the questioning comes first"),
      u("the confirmation connects me to the work"),
    ];
    const reflection = {
      claims: [
        claim(
          "the questioning connects to the confirmation",
          [
            {
              claimText: "questioning connects to confirmation",
              // AI cites the utterance with "questioning" — but it has no link.
              utteranceIds: [bank[0].id],
              userPhrase: "questioning connects to confirmation",
            },
          ],
          "connection",
        ),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "span_grounding")?.ok).toBe(false);
    // The Clarify-Mode hint points at the ungrounded span.
    expect(result.claims[0].weakestSpan?.userPhrase).toContain("connects");
  });

  it("Check 3: blocks a single smuggled meaning-word the average let through", () => {
    const bank = [u("there is real tension between the two ideas i keep circling")];
    const reflection = {
      claims: [
        claim("this is the real tension between the two central ideas", [
          {
            claimText: "real tension between the two ideas",
            utteranceIds: [bank[0].id],
            userPhrase: "real tension between the two ideas",
          },
        ]),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    // Broad overlap is high enough to pass, but "central" trips the fine part.
    const lexical = checkOf(result.claims[0], "lexical_grounding");
    expect(lexical?.ok).toBe(false);
    expect(partOf(lexical, "broad_overlap")?.ok).toBe(true);
    expect(partOf(lexical, "additions")?.ok).toBe(false);
  });

  it("validates chunks independently — one passes while another fails", () => {
    const bank = [
      u("the chat is where i do my thinking"),
      u("i want the map to show what i decided"),
    ];
    const reflection = {
      claims: [
        claim("the chat is where you do your thinking", [
          {
            claimText: "chat is where thinking",
            utteranceIds: [bank[0].id],
            userPhrase: "chat is where i do my thinking",
          },
        ]),
        claim("the map proves your intellectual rigor", [
          {
            claimText: "map proves intellectual rigor",
            utteranceIds: [bank[1].id],
            userPhrase: "map to show what i decided",
          },
        ]),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false); // whole reflection not all-pass
    expect(result.claims[0].ok).toBe(true);
    expect(result.claims[1].ok).toBe(false);
  });

  it("Fix 2: blocks a connection decomposed into per-entity spans (relationship ungrounded)", () => {
    // Both entities exist in the bank and "connects" appears somewhere, so the
    // old per-span checks would pass. But the user never linked A to B — the AI
    // split the claim into one span per entity to dodge grounding the relation.
    const bank = [
      u("the questioning is something i value"),
      u("the confirmation is a separate step"),
      u("two unrelated ideas can connect on their own"),
    ];
    const reflection = {
      claims: [
        claim(
          "the questioning connects to the confirmation",
          [
            { claimText: "questioning", utteranceIds: [bank[0].id], userPhrase: "the questioning" },
            { claimText: "confirmation", utteranceIds: [bank[1].id], userPhrase: "the confirmation" },
          ],
          "connection",
        ),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "span_grounding")?.ok).toBe(false);
  });

  it("Fix 2: accepts a connection when one span carries the user's relational phrase, single-grounded", () => {
    const bank = [u("the visualization depends on the questioning happening first")];
    const reflection = {
      claims: [
        claim(
          "the visualization depends on the questioning",
          [
            {
              claimText: "the visualization depends on the questioning",
              utteranceIds: [bank[0].id],
              userPhrase: "the visualization depends on the questioning",
            },
          ],
          "connection",
        ),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(true);
  });

  it("blocks two grounded user sentences stitched together with an invented connective", () => {
    // Each sentence is fully grounded and each happens to contain a relational
    // word, so every per-span check passes — but "leads to" joining them is the
    // AI's invention. The claim's relationship must be stated in ONE utterance.
    const bank = [
      u("user trust depends on data provenance"),
      u("shared control shapes the outcome for new users"),
    ];
    const stitched =
      "user trust depends on data provenance leads to shared control shapes the outcome for new users";
    const reflection = {
      claims: [
        claim(
          stitched,
          [
            {
              claimText: bank[0].text,
              utteranceIds: [bank[0].id],
              userPhrase: bank[0].text,
            },
            {
              claimText: bank[1].text,
              utteranceIds: [bank[1].id],
              userPhrase: bank[1].text,
            },
          ],
          "connection",
        ),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "span_grounding")?.ok).toBe(false);
  });

  it("blocks a stitched connective even when one grounded sentence dominates the token mass", () => {
    // The stitched-on tail ("nope") is tiny, so a pure content-overlap ratio
    // against the long sentence still clears the threshold. The invented
    // "leads to" connective must be caught by the term binding itself.
    const bank = [
      u("shared control connects to team judgment when nobody is watching"),
      u("nope"),
      u("one thing leads to another sometimes"), // grounds "leads" lexically
    ];
    const stitched =
      "shared control connects to team judgment when nobody is watching leads to nope";
    const reflection = {
      claims: [
        claim(
          stitched,
          [
            { claimText: bank[0].text, utteranceIds: [bank[0].id], userPhrase: bank[0].text },
            { claimText: bank[1].text, utteranceIds: [bank[1].id], userPhrase: bank[1].text },
          ],
          "connection",
        ),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "span_grounding")?.ok).toBe(false);
  });

  it("still accepts a relational claim citing extra context when the relation lives in one utterance", () => {
    const bank = [
      u("the plan depends on trust between the teams"),
      u("trust is hard to rebuild"),
    ];
    const reflection = {
      claims: [
        claim(
          "the plan depends on trust between the teams",
          [
            {
              claimText: "the plan depends on trust between the teams",
              utteranceIds: [bank[0].id, bank[1].id],
              userPhrase: "the plan depends on trust between the teams",
            },
          ],
          "connection",
        ),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(true);
  });

  it("fails closed on an empty / span-less claim", () => {
    const bank = [u("something the user actually said here")];
    const reflection = { claims: [claim("entirely invented framing", [])] };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
  });
});
