import asyncio
import hashlib
import json
import os
import random
from typing import Any, Iterable, List, Dict, Optional

from dotenv import load_dotenv
from pydantic import BaseModel

import openai
from openai.types.chat.chat_completion_message_param import ChatCompletionMessageParam
from openai import AsyncOpenAI

MODEL_NAME = "gpt-4o"
DEBUG_PROMPTS = False

# Create OpenAI client
load_dotenv()

openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

if openai_api_key == "":
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

openai_client = AsyncOpenAI(
    api_key=openai_api_key,
)


async def warmup_nlp():
    # Warm up the OpenAI client by making a dummy request
    dummy_client = openai.AsyncOpenAI(base_url="https://localhost:8000/v1", api_key="", timeout=0.01, max_retries=0)
    # make a dummy request to make sure everything is imported
    try:
        await dummy_client.chat.completions.create(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": "Hello"}],
        )
    except openai.APIConnectionError:
        # We expect this error because we're connecting to a non-existent server
        pass


prompts = {
    "example_sentences": """\
We're helping a writer draft a document. Please output three possible options for inspiring and fresh possible next sentences that would help the writer think about what they should write next. Guidelines:

- Focus on the area of the document that is closest to the writer's cursor.
- If the writer is in the middle of a sentence, output three possible continuations of that sentence.
- If the writer is at the end of a paragraph, output three possible sentences that would start the next paragraph.
- The three sentences should be three different paths that the writer could take, each starting from the current point in the document; they do **NOT** go in sequence.
- Each output should be *at most one sentence* long.
- Use ellipses to truncate sentences that are longer than about 20 words.
""",
    "proposal_advice": """\
We're helping a writer draft a document. Please output three actionable, inspiring, and fresh directive instructions that would help the writer think about what they should write next. Guidelines:

- Focus on the area of the document that is closest to the writer's cursor.
- Don't give specific words or phrases for the writer to use.
- Keep each piece of advice concise.
- Express the advice in the form of a directive instruction, not a question.
- Make each piece of advice very specific to the current document, not general advice that could apply to any document.
""",
    "analysis_readerPerspective": """\
You are assisting in drafting a document for a specific person. Generate three possible questions the person might have about the document so far.

Guidelines:

- Avoid suggesting specific words or phrases.
- Limit each question to under 20 words.
- Ensure all questions specifically reflect details or qualities from the current document, avoiding broad or generic statements.
- Each question should be expressed as a perspective describing how the person might feel about the document, not as a directive to the writer.
- If there is insufficient context to generate genuine questions, return an empty list.
""",
    "complete_document": """\
We're helping a writer complete and polish their document. Please provide a completed and polished version of the document that the writer has started writing. Guidelines:

- Use the text in the document as a starting point, but make any changes needed to make the document complete and polished.
- Maintain the writer's tone, style, and voice throughout.
- Polish the text for clarity and coherence.
"""
}


class ContextSection(BaseModel):
    title: str
    content: str

class DocContext(BaseModel):
    contextData: Optional[List[ContextSection]] = None
    falseContextData: Optional[List[ContextSection]] = None
    beforeCursor: str
    selectedText: str
    afterCursor: str


class GenerationResult(BaseModel):
    generation_type: str
    result: str
    extra_data: Dict[str, Any]



def get_full_prompt(prompt_name: str, doc_context: DocContext, context_chars: int = 100, use_false_context: bool = False) -> str:
    prompt = prompts[prompt_name]

    # Choose which context to use based on the flag
    context_data = doc_context.falseContextData if use_false_context else doc_context.contextData
    
    if context_data:
        context_sections = "\n\n".join(
            [f"## {section.title}\n\n{section.content}" for section in context_data]
        )
        prompt += f"\n\n# Additional Context (will *not* be visible to the reader of the document):\n\n{context_sections}"

    document_text = doc_context.beforeCursor + doc_context.selectedText + doc_context.afterCursor

    prompt += f"\n\n# Writer's Document So Far\n\n<document>\n{document_text}</document>\n\n"
    before_cursor_trim = doc_context.beforeCursor[-context_chars:]
    after_cursor_trim = doc_context.afterCursor[:context_chars]
    if doc_context.selectedText == '':
        prompt += f"\n\n## Text Right Before the Cursor\n\n\"{before_cursor_trim}\""
    else:
        prompt += f"\n\n## Current Selection\n\n{doc_context.selectedText}"
        prompt += f"\n\n## Text Nearby The Selection\n\n\"{before_cursor_trim}{doc_context.selectedText}{after_cursor_trim}\""
    return prompt


class ListResponse(BaseModel):
    responses: List[str]


async def _get_suggestions_from_context(prompt_name: str, doc_context: DocContext, use_false_context: bool = False) -> List[str]:
    """Helper function to get suggestions from a specific context"""
    full_prompt = get_full_prompt(prompt_name, doc_context, use_false_context=use_false_context)
    if DEBUG_PROMPTS:
        context_type = "false" if use_false_context else "true"
        print(f"Prompt for {prompt_name} ({context_type} context):\n{full_prompt}\n")
    
    completion = await openai_client.chat.completions.parse(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": "You are a helpful and insightful writing assistant."},
            {"role": "user", "content": full_prompt}
        ],
        response_format=ListResponse
    )

    suggestion_response = completion.choices[0].message.parsed
    if suggestion_response is None:
        return []

    return suggestion_response.responses


async def get_suggestion(prompt_name: str, doc_context: DocContext) -> GenerationResult:
    # Special handling for complete_document: always use false context only, plain completion
    if prompt_name == "complete_document":
        full_prompt = get_full_prompt(prompt_name, doc_context, use_false_context=True)
        if DEBUG_PROMPTS:
            print(f"Prompt for {prompt_name} (false context only):\n{full_prompt}\n")
        completion = await openai_client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful and insightful writing assistant."},
                {"role": "user", "content": full_prompt}
            ]
        )

        result = completion.choices[0].message.content
        if not result:
            raise ValueError("No response found from complete_document.")
        return GenerationResult(generation_type=prompt_name, result=result, extra_data={})

    # If falseContextData is None/empty, use baseline behavior
    if not doc_context.falseContextData:
        full_prompt = get_full_prompt(prompt_name, doc_context)
        if DEBUG_PROMPTS:
            print(f"Prompt for {prompt_name} (baseline):\n{full_prompt}\n")
        completion = await openai_client.chat.completions.parse(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful and insightful writing assistant."},
                {"role": "user", "content": full_prompt}
            ],
            response_format=ListResponse
        )

        suggestion_response = completion.choices[0].message.parsed
        if not suggestion_response or not suggestion_response:
            raise ValueError("No suggestions found in the response.")
        markdown_response = "\n\n".join(
            [f"- {item}" for item in suggestion_response.responses]
        )
        return GenerationResult(generation_type=prompt_name, result=markdown_response, extra_data={})

    # Study mode: parallel calls with mixing
    true_suggestions_task = _get_suggestions_from_context(prompt_name, doc_context, use_false_context=False)
    false_suggestions_task = _get_suggestions_from_context(prompt_name, doc_context, use_false_context=True)
    
    # Execute both calls in parallel
    true_suggestions, false_suggestions = await asyncio.gather(true_suggestions_task, false_suggestions_task)

    if len(true_suggestions) == 0 or len(false_suggestions) == 0:
        # One or both of the queries refused.
        return GenerationResult(generation_type=prompt_name, result="", extra_data={})

    if len(true_suggestions) != 3 or len(false_suggestions) != 3:
        raise ValueError("Unexpected number of suggestions returned.")

    # Create seed from request body hash for repeatable shuffling
    request_body = {
        "prompt_name": prompt_name,
        "beforeCursor": doc_context.beforeCursor,
        "selectedText": doc_context.selectedText,
        "afterCursor": doc_context.afterCursor,
        "contextData": [{"title": s.title, "content": s.content} for s in doc_context.contextData] if doc_context.contextData else None,
        "falseContextData": [{"title": s.title, "content": s.content} for s in doc_context.falseContextData] if doc_context.falseContextData else None
    }
    request_hash = hashlib.sha256(json.dumps(request_body, sort_keys=True).encode()).hexdigest()
    shuffle_seed = int(request_hash[:8], 16)  # Use first 8 hex chars as seed
    
    # Combine and shuffle suggestions
    all_suggestions = []
    for i, suggestion in enumerate(true_suggestions):
        all_suggestions.append({"content": suggestion, "source": "true", "original_index": i})
    for i, suggestion in enumerate(false_suggestions):
        all_suggestions.append({"content": suggestion, "source": "false", "original_index": i})

    # Shuffle with deterministic seed
    random.seed(shuffle_seed)

    # Ensure that the 3 selected suggestions include at least 1 true and 1 false
    while True:
        random.shuffle(all_suggestions)
        selected_suggestions = all_suggestions[:3]
        if len(set(item["source"] for item in selected_suggestions)) > 1:
            break

    # Create markdown response
    markdown_response = "\n\n".join([f"- {item['content']}" for item in selected_suggestions])
    
    # Create metadata for logging
    extra_data = {
        "shuffle_seed": shuffle_seed,
        "request_hash": request_hash,
        "suggestion_sources": [{"content": item["content"], "source": item["source"], "original_index": item["original_index"]} for item in selected_suggestions],
        "total_true_suggestions": sum(1 for item in selected_suggestions if item["source"] == "true"),
        "total_false_suggestions": sum(1 for item in selected_suggestions if item["source"] == "false")
    }
    
    return GenerationResult(generation_type=prompt_name, result=markdown_response, extra_data=extra_data)



def obscure(token):
    word = token.text
    return "·" * len(word) + token.whitespace_


async def chat(messages: Iterable[ChatCompletionMessageParam], temperature: float) -> str:
    response = await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=temperature,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
    )

    result = response.choices[0].message.content

    # FIXME: figure out why result might ever be None
    return result or ""

def chat_stream(messages: Iterable[ChatCompletionMessageParam], temperature: float):
    return openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=temperature,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True,
    )


async def reflection(userDoc: str, paragraph: str) -> GenerationResult:
    temperature = 1.0

    questions = await chat(
        messages=[
            {"role": "system", "content": userDoc},
            {"role": "user", "content": paragraph},
        ],
        temperature=temperature,
    )

    return GenerationResult(
        generation_type="Reflection",
        result=questions,
        extra_data={
            "prompt": userDoc,
            "temperature": temperature,
        })


