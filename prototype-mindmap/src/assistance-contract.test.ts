import { describe, expect, it } from "vitest";
import { ASSISTANCE_CONTRACTS, normalizeInfluenceTrace, snapshotContract } from "./assistance-contract";
import { parseAssistantResponse, renderContext } from "./api";
import { defaultConfig } from "./config";

describe("assistance contracts", () => {
  it("defines three immutable contribution boundaries", () => {
    expect(ASSISTANCE_CONTRACTS[0].allowedResponseKinds).not.toContain("options");
    expect(ASSISTANCE_CONTRACTS[1].optionsMustBeVerbatim).toBe(true);
    expect(ASSISTANCE_CONTRACTS[2].allowsAiSuggestedStructure).toBe(true);
    expect(snapshotContract(ASSISTANCE_CONTRACTS[0]).mapWritePolicy).toBe("user_confirmation_required");
  });

  it("parses source-backed options and an explicitly separate suggestion", () => {
    const options = parseAssistantResponse({ response: { kind: "options", text: "Which fits?", options: [{ text: "human control", sourceSpans: [{ userPhrase: "human control", utteranceIds: ["u1"] }] }] } });
    expect(options.response).toMatchObject({ kind: "options", options: [{ text: "human control" }] });
    expect(parseAssistantResponse({ response: { kind: "suggestion", text: "One possible lens is authorship." } }).response.kind).toBe("suggestion");
  });

  it("renders the active contract as a prompt constraint rather than a write authorization", () => {
    const rendered = renderContext({
      bank: [], candidates: [], turnShape: { kind: "compact", reasons: [], utteranceCount: 1, contentTokenCount: 1, characterCount: 1 }, capabilities: defaultConfig.capabilities,
      mapPacing: { cardCount: 0, connectionCount: 0, isSparse: true }, reflectionRhythm: { turnsSinceLastReflection: 0, sourceUtteranceCount: 0 }, thinkMapBias: 50, map: { thoughtUnits: [], connections: [] },
      assistanceContract: snapshotContract(ASSISTANCE_CONTRACTS[1]),
    });
    expect(rendered).toContain("Grounded options");
    expect(rendered).toContain("never a map-write authorization");
  });

  it("preserves older echo traces without inventing a percentage", () => {
    expect(normalizeInfluenceTrace({ priorAssistantMessageId: 3, exactOverlapPhrases: ["human control"] }))
      .toEqual({ priorAssistantMessageId: 3, exactOverlapPhrases: ["human control"], overlapRatio: undefined });
  });
});
