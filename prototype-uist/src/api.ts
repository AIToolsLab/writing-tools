/// <reference types="vite/client" />

import type {
  ChatMessage,
  CoachExtractionResponse,
  PlacementSuggestionResponse,
  WordBankItem,
} from "./types";

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "http://localhost:8000/api";
const MODEL = "gpt-4o";

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const PHILOSOPHY = `You are a writing coach and secretary. You help the writer
think, reflect, and place their own language into a draft. You must not write
finished essay prose for the user. You may ask focused questions, summarize what
the writer has already said, extract exact user-owned wording, and suggest where
approved wording could fit in the draft.`;

async function chatJSON<T>(messages: OpenAIChatMessage[]): Promise<T> {
  const response = await fetch(`${BACKEND_URL}/openai/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
      stream: false,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Backend ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("The backend returned an empty model response.");
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error(`The model returned invalid JSON: ${content.slice(0, 200)}`);
  }
}

export async function coachAndExtractFromUserMessage(input: {
  draft: string;
  recentMessages: ChatMessage[];
  latestUserMessage: ChatMessage;
  bankItems: WordBankItem[];
}): Promise<CoachExtractionResponse> {
  const recentConversation = input.recentMessages
    .slice(-6)
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join("\n");
  const approvedBankPreview = input.bankItems
    .filter((item) => item.status === "approved")
    .slice(0, 10)
    .map((item) => `- ${item.text}`)
    .join("\n");

  const result = await chatJSON<{
    reply?: string;
    candidateTexts?: string[];
  }>([
    {
      role: "system",
      content: `${PHILOSOPHY}

Return JSON only. The "reply" must be coaching text only: concise, reflective,
and never drafted essay prose. The "candidateTexts" array must contain exact
substrings copied verbatim from the latest user message only. No paraphrase. No
new words. No punctuation cleanup. No combining fragments from separate messages.`,
    },
    {
      role: "user",
      content: `Current draft:
"""
${input.draft || "(empty draft)"}
"""

Recent conversation:
${recentConversation || "(none yet)"}

Current approved word bank:
${approvedBankPreview || "(empty)"}

Latest user message:
"""
${input.latestUserMessage.text}
"""

Return JSON with this exact shape:
{
  "reply": string,
  "candidateTexts": string[]
}

Rules:
- "reply" should either ask one focused next question or briefly reflect what
  the user just clarified.
- Do not write polished document sentences for them.
- "candidateTexts" should contain 0-3 snippets that look usable in a draft.
- Every candidate must be copied exactly from the latest user message.
- If there are no clean snippets, return an empty array.`,
    },
  ]);

  return {
    reply:
      result.reply?.trim() ||
      "What part of your draft feels underdeveloped right now?",
    candidateTexts: (result.candidateTexts ?? [])
      .map((text) => text.trim())
      .filter(Boolean),
  };
}

export async function suggestInsertionPlacement(input: {
  draft: string;
  bankItemText: string;
  selectedText: string;
  cursorBefore: string;
  cursorAfter: string;
  placeholderOptions: string[];
}): Promise<PlacementSuggestionResponse> {
  const placeholderList =
    input.placeholderOptions.length > 0
      ? input.placeholderOptions.map((text) => `- ${text}`).join("\n")
      : "(none found)";

  const result = await chatJSON<{
    targetKind?: "selection" | "cursor" | "append" | "placeholder";
    placeholder?: string;
    reason?: string;
  }>([
    {
      role: "system",
      content: `${PHILOSOPHY}

You are suggesting an insertion target, not writing content. Choose exactly one
of these target kinds: selection, cursor, append, placeholder.`,
    },
    {
      role: "user",
      content: `Draft:
"""
${input.draft || "(empty draft)"}
"""

Approved bank item:
"${input.bankItemText}"

Current selected text:
"""
${input.selectedText || "(nothing selected)"}
"""

Text before the cursor:
"""
${input.cursorBefore || "(start of draft)"}
"""

Text after the cursor:
"""
${input.cursorAfter || "(end of draft)"}
"""

Placeholder options found in the draft:
${placeholderList}

Return JSON:
{
  "targetKind": "selection" | "cursor" | "append" | "placeholder",
  "placeholder": string,
  "reason": string
}

Rules:
- Suggest "selection" only if replacing the current selection makes sense.
- Suggest "cursor" only if the current cursor context seems right.
- Suggest "placeholder" only if one of the listed placeholders should be replaced.
- Suggest "append" when no stronger placement is available.
- "placeholder" must exactly match one listed placeholder when targetKind is placeholder.
- "reason" should be short and explain the placement logic.
- Do not write the document text itself.`,
    },
  ]);

  const targetKind = result.targetKind ?? "append";
  return {
    target: {
      kind: targetKind,
      placeholder:
        targetKind === "placeholder" ? result.placeholder?.trim() : undefined,
    },
    reason:
      result.reason?.trim() ||
      "This target best matches where the bank item seems to belong.",
  };
}
