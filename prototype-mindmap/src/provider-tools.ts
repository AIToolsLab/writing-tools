export type ProviderTransport = "chat_json" | "responses_tools";
export type MindmapToolName = "propose_reflection_v1" | "propose_map_action_v1";

type JsonSchema = Record<string, unknown>;

const stringArray: JsonSchema = { type: "array", items: { type: "string" } };
const sourceSpanSchema: JsonSchema = {
  type: "object",
  properties: {
    claimText: { type: "string" },
    userPhrase: { type: "string" },
    utteranceIds: stringArray,
  },
  required: ["claimText", "userPhrase", "utteranceIds"],
  additionalProperties: false,
};
const relationEvidenceSchema: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: { utteranceId: { type: "string" }, text: { type: "string" } },
      required: ["utteranceId", "text"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
};
const recallSchema: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: { candidateId: { type: "string" }, sourceUtteranceId: { type: "string" }, userPhrase: { type: "string" } },
      required: ["candidateId", "sourceUtteranceId", "userPhrase"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
};
const proposedRefSchema: JsonSchema = {
  type: "object",
  properties: {
    id: { type: ["string", "null"] },
    text: { type: ["string", "null"] },
    sourceUtteranceIds: stringArray,
  },
  required: ["id", "text", "sourceUtteranceIds"],
  additionalProperties: false,
};

const actionSchema: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: { kind: { const: "create_card" }, text: { type: "string" }, sourceUtteranceIds: stringArray },
      required: ["kind", "text", "sourceUtteranceIds"], additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "edit_card" }, id: { type: "string" }, text: { type: "string" }, sourceUtteranceIds: stringArray },
      required: ["kind", "id", "text", "sourceUtteranceIds"], additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "nest_card" }, child: proposedRefSchema, parent: proposedRefSchema, relationEvidence: relationEvidenceSchema },
      required: ["kind", "child", "parent", "relationEvidence"], additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "connect_cards" }, source: proposedRefSchema, target: proposedRefSchema,
        labelText: { type: ["string", "null"] }, labelSourceUtteranceIds: stringArray,
        relationEvidence: relationEvidenceSchema,
      },
      required: ["kind", "source", "target", "labelText", "labelSourceUtteranceIds", "relationEvidence"],
      additionalProperties: false,
    },
  ],
};

const reflectionSchema: JsonSchema = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string" }, text: { type: "string" }, candidateId: { type: "string" },
          target: { type: "string", enum: ["idea", "hierarchy", "connection"] },
          sourceSpans: { type: "array", minItems: 1, items: sourceSpanSchema },
          relationSpan: relationEvidenceSchema,
        },
        required: ["id", "text", "candidateId", "target", "sourceSpans", "relationSpan"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
};

const toolAdvisorySchema: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        candidateUpserts: {
          type: "array", items: {
            type: "object",
            properties: {
              id: { type: "string" }, target: { type: "string", enum: ["idea", "hierarchy", "connection"] },
              gist: { type: "string" }, addEvidenceIds: stringArray,
              status: { type: "string", enum: ["active", "parked"] },
            },
            required: ["id", "target", "gist", "addEvidenceIds", "status"], additionalProperties: false,
          },
        },
        affect: { type: ["string", "null"], enum: ["exhausted", "frustrated", "overwhelmed", "energized", null] },
      },
      required: ["candidateUpserts", "affect"], additionalProperties: false,
    },
    { type: "null" },
  ],
};

export const MINDMAP_PROVIDER_TOOLS = [
  {
    type: "function",
    name: "propose_reflection_v1",
    description: "Offer a user-grounded reflection for explicit review. This does not write to the map.",
    strict: true,
    parameters: {
      type: "object",
      properties: { text: { type: "string" }, reflection: reflectionSchema, advisory: toolAdvisorySchema },
      required: ["text", "reflection", "advisory"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "propose_map_action_v1",
    description: "Offer one structural map action for explicit review. This does not write to the map.",
    strict: true,
    parameters: {
      type: "object",
      properties: { text: { type: "string" }, action: actionSchema, candidateId: { type: ["string", "null"] }, advisory: toolAdvisorySchema },
      required: ["text", "action", "candidateId", "advisory"],
      additionalProperties: false,
    },
  },
] as const;

const conversationalResponseSchema: JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { const: "question" }, text: { type: "string" },
        stance: { type: ["string", "null"], enum: ["settle", "narrow", "deepen", "organize", "challenge", null] },
        anchor: { type: ["string", "null"] },
        recall: recallSchema,
      },
      required: ["kind", "text", "stance", "anchor", "recall"], additionalProperties: false,
    },
    { type: "object", properties: { kind: { const: "aside" }, text: { type: "string" }, recall: recallSchema }, required: ["kind", "text", "recall"], additionalProperties: false },
    {
      type: "object",
      properties: {
        kind: { const: "options" }, text: { type: "string" },
        options: {
          type: "array", minItems: 1, items: {
            type: "object",
            properties: { text: { type: "string" }, sourceSpans: { type: "array", minItems: 1, items: sourceSpanSchema } },
            required: ["text", "sourceSpans"], additionalProperties: false,
          },
        },
      },
      required: ["kind", "text", "options"], additionalProperties: false,
    },
    { type: "object", properties: { kind: { const: "suggestion" }, text: { type: "string" } }, required: ["kind", "text"], additionalProperties: false },
  ],
};

const advisorySchema = toolAdvisorySchema;

export const CONVERSATIONAL_TEXT_FORMAT = {
  type: "json_schema",
  name: "mindmap_conversational_response_v1",
  strict: true,
  schema: {
    type: "object",
    properties: { response: conversationalResponseSchema, advisory: advisorySchema },
    required: ["response", "advisory"],
    additionalProperties: false,
  },
} as const;

export interface ResponsesFunctionCall {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

export interface ParsedResponsesOutput {
  responseId?: string;
  output: unknown[];
  rawEnvelope: unknown;
  toolCall?: { name: MindmapToolName; callId: string; arguments: unknown };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function parseResponsesOutput(value: unknown): ParsedResponsesOutput {
  const body = record(value);
  const output = Array.isArray(body?.output) ? body.output : [];
  const calls = output.filter((item) => record(item)?.type === "function_call").map((item) => record(item)!);
  const messages = output.filter((item) => record(item)?.type === "message").map((item) => record(item)!);
  if (calls.length > 1) throw new Error("multiple_provider_tool_calls");
  if (calls.length && messages.length) throw new Error("mixed_provider_output");

  if (calls.length === 1) {
    const call = calls[0];
    const name = call.name;
    const callId = call.call_id;
    if (name !== "propose_reflection_v1" && name !== "propose_map_action_v1") throw new Error("unknown_provider_tool");
    if (typeof callId !== "string" || !callId) throw new Error("missing_provider_call_id");
    if (typeof call.arguments !== "string") throw new Error("invalid_provider_tool_arguments");
    let args: unknown;
    try { args = JSON.parse(call.arguments); } catch { throw new Error("invalid_provider_tool_arguments"); }
    const parsed = record(args);
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) throw new Error("invalid_provider_tool_arguments");
    if (!("advisory" in parsed)) throw new Error("invalid_provider_tool_arguments");
    const rawEnvelope = name === "propose_reflection_v1"
      ? { response: { kind: "reflection", text: parsed.text, reflection: parsed.reflection }, advisory: parsed.advisory }
      : { response: { kind: "map_proposal", text: parsed.text, action: parsed.action, candidateId: parsed.candidateId }, advisory: parsed.advisory };
    return { responseId: typeof body?.id === "string" ? body.id : undefined, output, rawEnvelope, toolCall: { name, callId, arguments: args } };
  }

  if (messages.length !== 1) throw new Error("missing_provider_visible_response");
  const content = Array.isArray(messages[0].content) ? messages[0].content : [];
  const textItems = content.filter((item) => record(item)?.type === "output_text").map((item) => record(item)?.text).filter((item): item is string => typeof item === "string");
  if (textItems.length !== 1) throw new Error("invalid_provider_visible_response");
  let rawEnvelope: unknown;
  try { rawEnvelope = JSON.parse(textItems[0]); } catch { throw new Error("invalid_provider_visible_json"); }
  return { responseId: typeof body?.id === "string" ? body.id : undefined, output, rawEnvelope };
}
