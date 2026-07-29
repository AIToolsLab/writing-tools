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
  relationSpan?: MirrorClaim["relationSpan"],
): MirrorClaim {
  return { id: `c-${text.slice(0, 8)}`, text, candidateId: "cand", target, sourceSpans: spans, relationSpan };
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

describe("mirror validator — 2 grounding checks", () => {
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
    expect(partOf(lexical, "all_content_words_cited")?.ok).toBe(false);
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
          { utteranceId: bank[0].id, text: "depends on" },
        ),
      ],
    };
    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "span_grounding")?.ok).toBe(false);
    // The Clarify-Mode hint points at the ungrounded span.
    expect(result.claims[0].weakestSpan?.userPhrase).toContain("connects");
  });

  it("blocks a single smuggled meaning-word with no unsupported-word budget", () => {
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
    // Every claimed content word must be cited; "central" cannot ride along.
    const lexical = checkOf(result.claims[0], "lexical_grounding");
    expect(lexical?.ok).toBe(false);
    expect(partOf(lexical, "all_content_words_cited")?.ok).toBe(false);
    expect(partOf(lexical, "additions")?.ok).toBe(false);
  });

  it("does not let an uncited Source Bank word launder a reflection claim", () => {
    const cited = u("language matters");
    const uncited = u("translation shapes thought");
    const reflection = {
      claims: [
        claim("language shapes thought", [{
          claimText: "language",
          utteranceIds: [cited.id],
          userPhrase: "language",
        }]),
      ],
    };

    const result = validateMirror(reflection, [cited, uncited], defaultConfig);
    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "lexical_grounding")?.ok).toBe(false);
  });

  it("blocks unsupported modal or hedge content without a special word bank", () => {
    const bank = [u("language shapes thought")];
    const reflection = {
      claims: [
        claim("language necessarily shapes thought", [{
          claimText: "language shapes thought",
          utteranceIds: [bank[0].id],
          userPhrase: "language shapes thought",
        }]),
      ],
    };

    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(false);
    expect(partOf(checkOf(result.claims[0], "lexical_grounding"), "additions")?.ok).toBe(false);
    expect(result.claims[0].ungroundedContentWords).toEqual(["necessarily"]);
  });

  it("reports distinct unsupported content words in displayed order", () => {
    const bank = [u("language shapes thought")];
    const reflection = {
      claims: [
        claim("language necessarily transforms transformed thought", [{
          claimText: "language thought",
          utteranceIds: [bank[0].id],
          userPhrase: "language shapes thought",
        }]),
      ],
    };

    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.claims[0].ungroundedContentWords).toEqual(["necessarily", "transforms"]);
  });

  it("does not report ordinary function-word glue as ungrounded content", () => {
    const bank = [u("language shapes thought")];
    const reflection = {
      claims: [
        claim("language is what shapes the thought", [{
          claimText: "language shapes thought",
          utteranceIds: [bank[0].id],
          userPhrase: "language shapes thought",
        }]),
      ],
    };

    const result = validateMirror(reflection, bank, defaultConfig);
    expect(result.ok).toBe(true);
    expect(result.claims[0].ungroundedContentWords).toEqual([]);
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
          { utteranceId: bank[0].id, text: "depends on" },
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
          { utteranceId: bank[0].id, text: "depends on" },
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
          { utteranceId: bank[0].id, text: "depends on" },
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
          { utteranceId: bank[0].id, text: "depends on" },
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

  it("validates a Chinese reflection using only closed-class particle glue", () => {
    const source = u("语言塑造思想");
    const result = validateMirror({
      claims: [claim("语言也塑造思想", [{
        claimText: "语言也塑造思想",
        utteranceIds: [source.id],
        userPhrase: "语言塑造思想",
      }])],
    }, [source], defaultConfig);

    expect(result.ok).toBe(true);
    expect(result.claims[0].ungroundedContentWords).toEqual([]);
  });

  it("validates mixed Chinese and English evidence in one utterance", () => {
    const source = u("language 影响我的 identity");
    const result = validateMirror({
      claims: [claim("language 影响 identity", [{
        claimText: "language 影响 identity",
        utteranceIds: [source.id],
        userPhrase: "language 影响我的 identity",
      }])],
    }, [source], defaultConfig);

    expect(result.ok).toBe(true);
  });

  it("requires the nominated evidence phrase to occur in the cited original utterance", () => {
    const source = u("我想保留人的控制权");
    const result = validateMirror({
      claims: [claim("控制权很重要", [{
        claimText: "控制权很重要",
        utteranceIds: [source.id],
        userPhrase: "控制权很重要",
      }])],
    }, [source], defaultConfig);

    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "span_grounding")?.ok).toBe(false);
  });

  it.each([
    ["语言塑造思想", "language shapes thought"],
    ["language shapes thought", "语言塑造思想"],
  ])("rejects translated substantive wording as a mirror: %s -> %s", (sourceText, translatedText) => {
    const source = u(sourceText);
    const result = validateMirror({
      claims: [claim(translatedText, [{
        claimText: translatedText,
        utteranceIds: [source.id],
        userPhrase: sourceText,
      }])],
    }, [source], defaultConfig);

    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "lexical_grounding")?.ok).toBe(false);
  });

  it("accepts equivalent full-width punctuation and CJK quotation styles", () => {
    const source = u("我说：「控制权，很重要！」");
    const result = validateMirror({
      claims: [claim("控制权很重要", [{
        claimText: "控制权很重要",
        utteranceIds: [source.id],
        userPhrase: "\"控制权,很重要!\"",
      }])],
    }, [source], defaultConfig);

    expect(result.ok).toBe(true);
  });

  it("deliberately rejects Simplified and Traditional substitutions", () => {
    const source = u("我想保留控制权");
    const result = validateMirror({
      claims: [claim("我想保留控制權", [{
        claimText: "我想保留控制權",
        utteranceIds: [source.id],
        userPhrase: "我想保留控制權",
      }])],
    }, [source], defaultConfig);

    expect(result.ok).toBe(false);
    expect(checkOf(result.claims[0], "span_grounding")?.ok).toBe(false);
  });

  it("validates an explicitly stated cross-language relationship through one utterance", () => {
    const english = u("human control");
    const chinese = u("写作自由");
    const relation = u("human control 支持 写作自由");
    const result = validateMirror({
      claims: [claim(
        "human control 支持 写作自由",
        [
          { claimText: "human control", utteranceIds: [english.id, relation.id], userPhrase: "human control" },
          { claimText: "写作自由", utteranceIds: [chinese.id, relation.id], userPhrase: "写作自由" },
        ],
        "connection",
        { utteranceId: relation.id, text: "支持" },
      )],
    }, [english, chinese, relation], defaultConfig);

    expect(result.ok).toBe(true);
  });
});
