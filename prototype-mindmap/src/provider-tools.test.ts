import { describe, expect, it } from "vitest";
import { CONVERSATIONAL_TEXT_FORMAT, MINDMAP_PROVIDER_TOOLS, parseResponsesOutput } from "./provider-tools";

function assertStrictObjects(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") {
    expect(record.additionalProperties).toBe(false);
    expect(record.required).toEqual(Object.keys((record.properties ?? {}) as Record<string, unknown>));
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach(assertStrictObjects);
    else assertStrictObjects(child);
  }
}

function assertTypedConstants(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if ("const" in record) expect(record.type).toBe("string");
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach(assertTypedConstants);
    else assertTypedConstants(child);
  }
}

describe("provider proposal tools", () => {
  it("uses strict, closed schemas for every tool and conversational object", () => {
    for (const tool of MINDMAP_PROVIDER_TOOLS) {
      expect(tool.strict).toBe(true);
      assertStrictObjects(tool.parameters);
    }
    expect(CONVERSATIONAL_TEXT_FORMAT.strict).toBe(true);
    assertStrictObjects(CONVERSATIONAL_TEXT_FORMAT.schema);
    assertTypedConstants([MINDMAP_PROVIDER_TOOLS, CONVERSATIONAL_TEXT_FORMAT]);
    const schemas = JSON.stringify([MINDMAP_PROVIDER_TOOLS, CONVERSATIONAL_TEXT_FORMAT]);
    expect(schemas).toContain('"status"');
    expect(schemas).toContain('"recall"');
    expect(schemas).toContain('"grounded_recap"');
    expect(schemas).toContain('"translation"');
    expect(schemas).toContain('"ai_translated"');
    expect(schemas).not.toContain("candidateDeletes");
  });

  it("normalizes a map function call without executing it", () => {
    const parsed = parseResponsesOutput({
      id: "resp_1",
      output: [{
        type: "function_call", name: "propose_map_action_v1", call_id: "call_1",
        arguments: JSON.stringify({ text: "Review this.", action: { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] }, candidateId: "memory", advisory: { candidateUpserts: [], affect: null } }),
      }],
    });
    expect(parsed).toMatchObject({
      responseId: "resp_1",
      toolCall: { name: "propose_map_action_v1", callId: "call_1" },
      rawEnvelope: { response: { kind: "map_proposal", text: "Review this.", candidateId: "memory", action: { kind: "create_card" } }, advisory: { candidateUpserts: [] } },
    });
  });

  it("normalizes one conversational JSON message", () => {
    const parsed = parseResponsesOutput({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ response: { kind: "question", text: "What matters?" }, advisory: null }) }] }] });
    expect(parsed.rawEnvelope).toMatchObject({ response: { kind: "question", text: "What matters?" } });
  });

  it("rejects unknown, multiple, and mixed tool output", () => {
    expect(() => parseResponsesOutput({ output: [{ type: "function_call", name: "write_map", call_id: "c", arguments: "{}" }] })).toThrow("unknown_provider_tool");
    const call = { type: "function_call", name: "propose_map_action_v1", call_id: "c", arguments: JSON.stringify({ text: "x", action: {}, advisory: null }) };
    expect(() => parseResponsesOutput({ output: [call, { ...call, call_id: "d" }] })).toThrow("multiple_provider_tool_calls");
    expect(() => parseResponsesOutput({ output: [call, { type: "message", content: [{ type: "output_text", text: "{}" }] }] })).toThrow("mixed_provider_output");
  });

  it("rejects missing call ids and malformed arguments", () => {
    expect(() => parseResponsesOutput({ output: [{ type: "function_call", name: "propose_reflection_v1", arguments: "{}" }] })).toThrow("missing_provider_call_id");
    expect(() => parseResponsesOutput({ output: [{ type: "function_call", name: "propose_reflection_v1", call_id: "c", arguments: "{" }] })).toThrow("invalid_provider_tool_arguments");
  });
});
