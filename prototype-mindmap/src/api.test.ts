import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLLM } from "./api";
import type { LLMContext } from "./llm-contract";

function jsonResponse(content: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function textResponse(body: string): Response {
  return {
    ok: true,
    text: async () => body,
  } as unknown as Response;
}

const ctx: LLMContext = {
  bank: [],
  candidates: [],
  turnsSinceLastMirror: 0,
  detectedSignals: [],
  readyCandidateIds: [],
  userIsStuck: false,
  lastAiText: "",
  turnText: "hello",
  turnShape: { kind: "compact", reasons: [], selected: false },
  draftDeclarations: [],
  map: { thoughtUnits: [], connections: [] },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeLLM JSON resilience", () => {
  it("retries once on invalid JSON and parses the valid retry", async () => {
    // First response has unescaped double quotes inside a string value (the
    // exact gpt-5.4 failure mode from testing); the retry is valid.
    const invalid = '{"mode":"question","text":"what makes "A" different from "B"?"}';
    const valid = '{"mode":"question","text":"What next?"}';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(invalid))
      .mockResolvedValueOnce(jsonResponse(valid));
    vi.stubGlobal("fetch", fetchMock);

    const turn = await makeLLM()(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(turn.mode).toBe("question");
    expect(turn.text).toBe("What next?");
  });

  it("throws only after the retry also returns invalid JSON", async () => {
    const invalid = '{"mode":"question","text":"still "broken""}';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(invalid));
    vi.stubGlobal("fetch", fetchMock);

    await expect(makeLLM()(ctx)).rejects.toThrow(/invalid JSON/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces an empty backend body with a clear error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(""));
    vi.stubGlobal("fetch", fetchMock);

    await expect(makeLLM()(ctx)).rejects.toThrow(/empty response body/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces truncated backend JSON with a clear error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse('{"choices":'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(makeLLM()(ctx)).rejects.toThrow(/backend returned invalid json/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
