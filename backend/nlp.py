import os
from typing import Any, Iterable, List, Dict, Optional

from dotenv import load_dotenv
from pydantic import BaseModel

import openai
from openai.types.chat.chat_completion_message_param import ChatCompletionMessageParam
from posthog.ai.openai import AsyncOpenAI as _WrappedAsyncOpenAI
from posthog_client import posthog_client as ph_client

MODEL_PARAMS = {
    "model": "gpt-4o",
    # "model": "gpt-5-mini",
    # "reasoning_effort": "minimal",
    # "text_verbosity": "medium"
}
DEBUG_PROMPTS = False

load_dotenv()
openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

if openai_api_key == "":
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

# Always the PostHog-wrapped client; ph_client runs in disabled mode when
# PostHog is unconfigured, so this is a single code path either way.
openai_client = _WrappedAsyncOpenAI(api_key=openai_api_key, posthog_client=ph_client)


async def warmup_nlp():
    # Warm up the OpenAI client by making a dummy request
    dummy_client = openai.AsyncOpenAI(
        base_url="https://localhost:8000/v1", api_key="", timeout=0.01, max_retries=0
    )
    # make a dummy request to make sure everything is imported
    try:
        await dummy_client.chat.completions.create(
            model="gpt-4o",
            # model="gpt-5-mini",
            # reasoning_effort="minimal",
            messages=[{"role": "user", "content": "Hello"}],
        )
    except openai.APIConnectionError:
        # We expect this error because we're connecting to a non-existent server
        pass


prompts = {
    "example_sentences": """\
You are assisting a writer in drafting a document. Generate three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about **10 words**.
""",
    "proposal_advice": """\
You are assisting a writer in drafting a document by providing three directive (but not prescriptive) advice to help them develop their work. Your advice must be tailored to the document's genre. Use your best judgment to offer the most relevant and helpful advice, drawing from the following types of support as appropriate for the context:
- Support the writer in adhering to their stated writing goals or assignment guidelines.
- Help the writer think about what they could write next.
- Encourage the writer to maintain focus on their main idea and avoid introducing unrelated material.
- Recommend strengthening arguments by adding supporting evidence, specific examples, or clear reasoning.
- Advise on structuring material to achieve a clear and logical flow.
- Guide the writer in choosing language that is accessible and engaging for the intended audience.

Guidelines:
- Focus on the area of the document that is closest to the writer's cursor.
- Keep each piece of advice under 20 words.
- Express the advice in the form of a directive instruction, not a question.
- Don't give specific words or phrases for the writer to use.
- Make each piece of advice very specific to the current document, not general advice that could apply to any document.
""",
    "analysis_readerPerspective": """\
You are assisting a writer in drafting a document for a specific person. Generate three possible questions the person might have about the document so far.

Guidelines:
- Avoid suggesting specific words or phrases.
- Limit each question to under 20 words.
- Ensure all questions specifically reflect details or qualities from the current document, avoiding broad or generic statements.
- Each question should be expressed as a perspective describing how the person might feel about the document, not as a directive to the writer.
- If there is insufficient context to generate genuine questions, return an empty list.
""",
    "complete_document": """\
You are assisting a writer complete and polish their document. Please provide a completed and polished version of the document that the writer has started writing.

Guidelines:
- Use the text in the document as a starting point, but make any changes needed to make the document complete and polished.
- Maintain the writer's tone, style, and voice throughout.
- Polish the text for clarity and coherence.
""",
    "example_rewording": """\
You are assisting a writer in drafting a document. Generate three alternative rewordings of the writer's selected text.

Guidelines:
- Rephrase only the selected text in three different ways while preserving the original meaning.
- Vary the word choice, and tone across the three options.
- Maintain the writer's overall voice and style.
- Each rewording should be approximately the same length as the original selected text.
- If no text is selected, return an empty list.
"""
}


class ContextSection(BaseModel):
    title: str
    content: str


class DocContext(BaseModel):
    contextData: Optional[List[ContextSection]] = None
    beforeCursor: str
    selectedText: str
    afterCursor: str


class GenerationResult(BaseModel):
    generation_type: str
    result: str
    extra_data: Dict[str, Any]


def get_full_prompt(
    prompt_name: str,
    doc_context: DocContext,
    context_chars: int = 100,
) -> str:
    prompt = prompts[prompt_name]

    context_data = doc_context.contextData

    if context_data:
        context_sections = "\n\n".join(
            [f"## {section.title}\n\n{section.content}" for section in context_data]
        )
        prompt += f"\n\n# Additional Context (will *not* be visible to the reader of the document):\n\n{context_sections}"

    document_text = (
        doc_context.beforeCursor + doc_context.selectedText + doc_context.afterCursor
    )

    prompt += (
        f"\n\n# Writer's Document So Far\n\n<document>\n{document_text}</document>\n\n"
    )
    before_cursor_trim = doc_context.beforeCursor[-context_chars:]
    after_cursor_trim = doc_context.afterCursor[:context_chars]
    if doc_context.selectedText == "":
        prompt += f'\n\n## Text Right Before the Cursor\n\n"{before_cursor_trim}"'
    else:
        prompt += f"\n\n## Current Selection\n\n{doc_context.selectedText}"
        prompt += f'\n\n## Text Nearby The Selection\n\n"{before_cursor_trim}{doc_context.selectedText}{after_cursor_trim}"'
    return prompt


class ListResponse(BaseModel):
    responses: List[str]


async def get_suggestion(
    prompt_name: str,
    doc_context: DocContext,
) -> GenerationResult:
    # Early return for example_rewording when no text is selected
    if prompt_name == "example_rewording" and doc_context.selectedText.strip() == "":
        return GenerationResult(
            generation_type=prompt_name,
            result="Please select some text to get rewording suggestions.",
            extra_data={},
        )

    full_prompt = get_full_prompt(prompt_name, doc_context)

    # Full document completion doesn't use list response.
    if prompt_name == "complete_document":
        completion = await openai_client.chat.completions.create(
            **MODEL_PARAMS,
            messages=[
                {"role": "system", "content": "You are a helpful and insightful writing assistant."},
                {"role": "user", "content": full_prompt}
            ],
        )

        result = completion.choices[0].message.content
        if not result:
            raise ValueError("No response found from complete_document.")
        return GenerationResult(generation_type=prompt_name, result=result, extra_data={})

    if DEBUG_PROMPTS:
        print(f"Prompt for {prompt_name} (baseline):\n{full_prompt}\n")
    completion = await openai_client.beta.chat.completions.parse(
        **MODEL_PARAMS,
        messages=[
            {
                "role": "system",
                "content": "You are a helpful and insightful writing assistant.",
            },
            {"role": "user", "content": full_prompt},
        ],
        response_format=ListResponse,
    )

    suggestion_response = completion.choices[0].message.parsed
    if not suggestion_response:
        raise ValueError("No suggestions found in the response.")
    markdown_response = "\n\n".join(
        [f"- {item}" for item in suggestion_response.responses]
    )
    return GenerationResult(
        generation_type=prompt_name, result=markdown_response, extra_data={}
    )


def obscure(token):
    word = token.text
    return "·" * len(word) + token.whitespace_


async def chat(
    messages: Iterable[ChatCompletionMessageParam],
) -> str:
    response = await openai_client.chat.completions.create(
        **MODEL_PARAMS,
        messages=messages,
        max_tokens=1024,
    )

    result = response.choices[0].message.content

    # FIXME: figure out why result might ever be None
    return result or ""


def chat_stream(
    messages: Iterable[ChatCompletionMessageParam],
):
    return openai_client.chat.completions.create(
        **MODEL_PARAMS,
        messages=messages,
        max_tokens=1024,
        stream=True,
    )


async def reflection(
    userDoc: str,
    paragraph: str,
) -> GenerationResult:

    questions = await chat(
        messages=[
            {"role": "system", "content": userDoc},
            {"role": "user", "content": paragraph},
        ],
    )

    return GenerationResult(
        generation_type="Reflection",
        result=questions,
        extra_data={
            "prompt": userDoc,
        },
    )
