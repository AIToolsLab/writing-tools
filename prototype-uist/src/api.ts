/// <reference types="vite/client" />

import type {
  ChatMessage,
  CoachExtractionResponse,
  CoachMode,
  PlacementSuggestionResponse,
  WordBankItem,
} from "./types";

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "http://localhost:8000/api";
const MODEL = "gpt-5.4-mini";

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
    coachMode?: CoachMode;
    candidateTexts?: string[];
    focusQuote?: string;
    placementCandidateText?: string;
    placementIntent?: "prime" | "abandon" | "none";
    placementExpandHint?: string;
  }>([
    {
      role: "system",
      content: `${PHILOSOPHY}

Return JSON only.

COACHING ("reply" and "coachMode"):
You are a sharp, document-aware writing coach, not a generic chatbot. Reason
across the WHOLE draft, not just the latest message. Choose exactly one
"coachMode":
- "reflection": the writer is still forming the idea. Ask one question that
  surfaces a real assumption, tension, contradiction, or what changed their
  mind. You may productively challenge the writer, but never answer your own
  challenge or supply the idea for them.
- "writing": the writer already has a developed idea and needs help with the
  document: which paragraph it affects, whether to introduce it earlier,
  whether the conclusion should echo it, whether a bridge is missing between two
  named paragraphs.
- "placement": the writer is deciding WHERE an idea or approved bank text
  belongs in the draft.

PLACEMENT TRIGGER: If the user asks where an idea belongs (for example "where
does this go", "should this go in the conclusion", "should I introduce it
earlier", "where should I put this", "does this belong in this paragraph"),
choose "placement". Do NOT answer a location question with a generic reflection
question.

ANTI-LOOP: Never ask the user to restate or re-explain an idea they have
already stated as a clear claim, mechanism, or distinction. Once an insight is
developed, your one question MUST do something new: place it, connect it to
another draft region, challenge its implication, or ask whether it changes the
thesis. Do not re-ask the same question with different wording.

ADVANCE, DO NOT VALIDATE: If the user has already articulated a placement
decision, structural insight, or thesis implication, the next turn MUST advance
the discussion, not just confirm it. Agreement or paraphrase as the WHOLE reply
("that seems logical", "you've identified X", "placing it there makes sense") is
a failure: it must never replace the question, and you must never simply restate
what the user said. Always ask a question that forces a NEW decision: a different
placement, a connection to another region, an implication, a thesis impact, or
what the reader should understand at that point.

NATURAL AFFIRMATION: A brief, genuine affirmation is allowed occasionally (not
every turn) when the user says something genuinely sharp — e.g. "That's a useful
distinction —" or "Interesting point —" used as a short lead-in BEFORE the
question. Keep it to a few words, never let it paraphrase or restate the user's
idea, and always follow it immediately with the advancing question. Most turns
should still open straight into the question.

MANDATORY QUESTION: Every "reply" MUST contain exactly one question and MUST end
with it. A reply that is only an observation, affirmation, or summary with no
question is invalid.

Hard length limit: "reply" is at most one short grounding clause plus exactly
one question. Never write a paragraph of analysis. Never draft essay prose for
the user. A single sharp question tied to a concrete draft tension beats long
commentary.

ANCHORING ("focusQuote"):
- In "writing" and "placement" mode, "focusQuote" MUST be an exact substring
  copied verbatim from the current draft, naming the region the question is
  about. If you cannot find a real substring that fits, the question is not
  ready: ask a different question you CAN anchor. Never invent a quote.
- When the decision spans two regions (e.g. an example paragraph versus the
  conclusion), anchor "focusQuote" to the primary region the decision is mostly
  about, and refer to the second region in words.
- In "reflection" mode, anchor when the question is about a specific part of the
  draft; leave "focusQuote" empty only when the question is genuinely
  document-wide. Never invent a quote that is not in the draft.

PLACEMENT CANDIDATE ("placementCandidateText"):
In "placement" mode, set "placementCandidateText" to an exact substring copied
verbatim from one approved word-bank item (shown in "Current approved word
bank") that you are suggesting be placed. Leave it empty when the mode is not
placement or when no approved item fits. Never invent text and never copy from
the draft or the user's latest message here.

PLACEMENT INTENT ("placementIntent"):
- "abandon": the user signals they want to STOP the current placement, change
  their mind about placing the idea, or clearly pivots to an unrelated topic
  (e.g. "I don't want to place that", "never mind that", "let's talk about
  something else"). Use this so the app can clear the placement workspace.
- "prime": a normal placement turn where you are pointing at a spot.
- "none": any non-placement turn. Merely reflecting on the draft is "none", NOT
  "abandon" — only use "abandon" for a genuine stop/pivot.

EXPAND HINT ("placementExpandHint"):
In "placement" mode only, when the approved snippet you are pointing at seems too
thin for the spot (it would need more context, a connective phrase, or a sharper
version), do TWO things: (a) ask the user in "reply" to say it the way they would
want it to read there — you ask, you never rewrite it for them — and (b) set
"placementExpandHint" to a short hint for display next to the suggest box (e.g.
"This may need more context — say it the way you'd want it to read, or edit it in
the box."). Leave it empty when the snippet is already enough or mode is not
placement. Do not nudge on every placement turn — only when genuinely thin.

EXTRACTION ("candidateTexts"):
The "candidateTexts" array must contain exact substrings copied verbatim from
the latest user message only. No paraphrase. No new words. No punctuation
cleanup. No combining fragments from separate messages. Prefer the smallest
draft-usable span from the user's wording instead of including conversational
lead-ins like "I could talk about how" when a tighter exact substring would
work.

Do not extract conversational control language into "candidateTexts". If the
latest user message is mainly a request like asking where to focus, asking what
to improve, asking to switch topics, or giving process instructions, return an
empty candidate list.

Also do not extract evaluative or process commentary ABOUT the essay or the
writing process rather than content that could live in the draft. Exclude
judgments like "the ending feels weak to me", "the strongest part is the
discussion of Ada", "this paragraph needs work", or "I think this is good".
Extract only language that states an idea, claim, or example the writer could
actually put into the document.`,
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
  "coachMode": "reflection" | "writing" | "placement",
  "candidateTexts": string[],
  "focusQuote": string,
  "placementCandidateText": string,
  "placementIntent": "prime" | "abandon" | "none",
  "placementExpandHint": string
}

Rules:
- "reply" must contain exactly one question and end with it; an observation,
  agreement, or summary with no question is invalid.
- "reply" must be at most one short grounding clause plus that one question.
- "coachMode" must be one of "reflection", "writing", or "placement".
- If the user asks where an idea belongs, use "placement", not a generic
  reflection question.
- Do not re-ask an idea the user has already stated clearly; move to placement,
  connection, challenge, or thesis impact instead.
- If the user has already made a placement or structural decision, do not
  validate or restate it ("that seems logical", "you've identified X"); ask a
  question that forces a new decision.
- A brief affirmation ("That's a useful distinction —") is allowed occasionally
  as a short lead-in before the question, but never as the whole reply and never
  a paraphrase of the user's idea.
- Do not write polished document sentences for them.
- "candidateTexts" should contain 0-3 snippets that look usable in a draft.
- Every candidate must be copied exactly from the latest user message.
- Prefer shorter exact snippets when they preserve the user's meaning and sound
  more draft-ready than the full sentence.
- Do not extract questions to the coach, requests for help, or topic-switching
  language into the word bank.
- Do not extract evaluative or process commentary about the essay ("the ending
  feels weak", "the strongest part is..."); extract only content that could go
  into the draft.
- In "writing" and "placement" mode, "focusQuote" must be an exact substring of
  the current draft; if none fits, ask a different question you can anchor.
- In "reflection" mode, "focusQuote" may be empty when the question is
  document-wide; otherwise copy it exactly from the current draft.
- Never invent a "focusQuote" that is not in the draft.
- In "placement" mode, "placementCandidateText" must be an exact substring of an
  approved word-bank item; otherwise leave it empty. Never invent it.
- "placementIntent" is "abandon" only on a genuine stop/pivot, "prime" on a
  normal placement turn, otherwise "none". Reflecting on the draft is "none".
- "placementExpandHint" is set only in placement mode when the snippet is too
  thin for the spot; otherwise empty. Never rewrite the user's wording.
- If there are no clean snippets, return an empty array.`,
    },
  ]);

  const coachMode: CoachMode =
    result.coachMode === "writing" || result.coachMode === "placement"
      ? result.coachMode
      : "reflection";

  return {
    reply:
      result.reply?.trim() ||
      "What part of your draft feels underdeveloped right now?",
    coachMode,
    candidateTexts: (result.candidateTexts ?? [])
      .map((text) => text.trim())
      .filter(Boolean),
    focusQuote: result.focusQuote?.trim() || undefined,
    placementCandidateText:
      coachMode === "placement"
        ? result.placementCandidateText?.trim() || undefined
        : undefined,
    placementIntent:
      result.placementIntent === "abandon" || result.placementIntent === "prime"
        ? result.placementIntent
        : "none",
    placementExpandHint:
      coachMode === "placement"
        ? result.placementExpandHint?.trim() || undefined
        : undefined,
  };
}

export async function suggestInsertionPlacement(input: {
  draft: string;
  bankItemText: string;
  selectedText: string;
  cursorBefore: string;
  cursorAfter: string;
  placeholderOptions: string[];
  recentMessages: ChatMessage[];
}): Promise<PlacementSuggestionResponse> {
  const placeholderList =
    input.placeholderOptions.length > 0
      ? input.placeholderOptions.map((text) => `- ${text}`).join("\n")
      : "(none found)";
  const recentConversation = input.recentMessages
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join("\n");

  const result = await chatJSON<{
    targetKind?:
      | "selection"
      | "cursor"
      | "append"
      | "placeholder"
      | "before_paragraph"
      | "after_paragraph";
    placeholder?: string;
    anchorText?: string;
    reason?: string;
  }>([
    {
      role: "system",
      content: `${PHILOSOPHY}

You are suggesting an insertion target, not writing content. Choose exactly one
of these target kinds: selection, cursor, append, placeholder,
before_paragraph, after_paragraph.

Prefer a paragraph-anchored suggestion when the draft gives a clear home for
the bank text. Use append only as a last resort. Avoid placing text after a
references, works cited, bibliography, or citation section unless the draft
itself strongly requires that.`,
    },
    {
      role: "user",
      content: `Draft:
"""
${input.draft || "(empty draft)"}
"""

Recent conversation:
${recentConversation || "(none yet)"}

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
  "targetKind": "selection" | "cursor" | "append" | "placeholder" | "before_paragraph" | "after_paragraph",
  "placeholder": string,
  "anchorText": string,
  "reason": string
}

Rules:
- Suggest "selection" only if replacing the current selection makes sense.
- Suggest "cursor" only if the current cursor context seems right.
- Suggest "placeholder" only if one of the listed placeholders should be replaced.
- Suggest "before_paragraph" or "after_paragraph" when a nearby paragraph is the best home.
- Suggest "append" only when no stronger placement is available.
- "placeholder" must exactly match one listed placeholder when targetKind is placeholder.
- "anchorText" must be empty unless targetKind is before_paragraph or after_paragraph.
- When targetKind is before_paragraph or after_paragraph, "anchorText" must be copied exactly from the draft and should be a short snippet from the paragraph you want highlighted.
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
      anchorText:
        targetKind === "before_paragraph" || targetKind === "after_paragraph"
          ? result.anchorText?.trim()
          : undefined,
    },
    reason:
      result.reason?.trim() ||
      "This target best matches where the bank item seems to belong.",
  };
}
