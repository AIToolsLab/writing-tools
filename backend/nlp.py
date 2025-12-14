import asyncio
import hashlib
import json
import os
import random
from typing import Any, Iterable, List, Dict, Optional

from dotenv import load_dotenv
from pydantic import BaseModel
from pathlib import Path

from langfuse import Langfuse, observe, get_client

import openai
from openai.types.chat.chat_completion_message_param import ChatCompletionMessageParam
from openai import AsyncOpenAI

MODEL_PARAMS = {
    "model": "gpt-4o",
}
DEBUG_PROMPTS = False

# Load .env s
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)
openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

if openai_api_key == "":
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

# Validate Langfuse configuration
langfuse_public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
langfuse_secret_key = os.getenv("LANGFUSE_SECRET_KEY")
langfuse_base_url = os.getenv("LANGFUSE_BASE_URL")

if not langfuse_public_key or not langfuse_secret_key:
    raise Exception(
        "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set in .env file. "
        f"Current values: PUBLIC_KEY={'set' if langfuse_public_key else 'MISSING'}, "
        f"SECRET_KEY={'set' if langfuse_secret_key else 'MISSING'}, "
        f"BASE_URL={langfuse_base_url or 'MISSING'}"
    )

openai_client = AsyncOpenAI(
    api_key=openai_api_key,
)
 
langfuse = Langfuse(
    public_key=langfuse_public_key,
    secret_key=langfuse_secret_key,
    host=langfuse_base_url 
)


async def warmup_nlp():
    dummy_client = openai.AsyncOpenAI(
        base_url="https://localhost:8000/v1", api_key="", timeout=0.01, max_retries=0
    )
    try:
        await dummy_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hello"}],
        )
    except openai.APIConnectionError:
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


def get_full_prompt(
    prompt_name: str,
    doc_context: DocContext,
    context_chars: int = 100,
    use_false_context: bool = False,
) -> str:
    prompt = prompts[prompt_name]

    context_data = (
        doc_context.falseContextData if use_false_context else doc_context.contextData
    )

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


@observe(name="llm_parse_context", as_type="generation")
async def _get_suggestions_from_context(
    prompt_name: str, 
    doc_context: DocContext, 
    use_false_context: bool = False
) -> List[str]:
    """Helper function to get suggestions from a specific context"""
    context_type = "false" if use_false_context else "true"
    
    # Update current observation with metadata (v3 pattern because of langfuse_decorator version issues)
    langfuse = get_client()
    langfuse.update_current_observation(
        metadata={
            "prompt_name": prompt_name,
            "context_type": context_type,
            "use_false_context": use_false_context
        }
    )
    
    full_prompt = get_full_prompt(
        prompt_name, doc_context, use_false_context=use_false_context
    )
    if DEBUG_PROMPTS:
        print(f"Prompt for {prompt_name} ({context_type} context):\n{full_prompt}\n")

    completion = await openai_client.chat.completions.parse(
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
    if suggestion_response is None:
        return []

    return suggestion_response.responses


@observe(name="get_suggestion")
async def get_suggestion(prompt_name: str, doc_context: DocContext) -> GenerationResult:
    """
    Main function to get suggestions with Langfuse tracing.
    This creates a trace for each suggestion request.
    """
    # Update trace with metadata for filtering in Langfuse (v3 pattern)
    langfuse = get_client()

    langfuse.update_current_trace(
        name=f"suggestion_{prompt_name}",
        metadata={
            "suggestion_type": prompt_name,  # Primary field for evaluation filtering
            "has_false_context": doc_context.falseContextData is not None and len(doc_context.falseContextData) > 0,
            "has_true_context": doc_context.contextData is not None and len(doc_context.contextData) > 0,
            "document_length": len(doc_context.beforeCursor + doc_context.selectedText + doc_context.afterCursor),
            "has_selection": len(doc_context.selectedText) > 0,
            "model": MODEL_PARAMS["model"]
        },
        tags=[prompt_name, "suggestion"],
        session_id=prompt_name  # Groups all traces of same type together
       )
    # Special handling for complete_document: always use false context only, plain completion
    if prompt_name == "complete_document":
        full_prompt = get_full_prompt(prompt_name, doc_context, use_false_context=True)
        if DEBUG_PROMPTS:
            print(f"Prompt for {prompt_name} (false context only):\n{full_prompt}\n")
        
        completion = await openai_client.chat.completions.create(
            **MODEL_PARAMS,
            messages=[
                {"role": "system", "content": "You are a helpful and insightful writing assistant."},
                {"role": "user", "content": full_prompt}
            ]
        )

        result = completion.choices[0].message.content
        if not result:
            raise ValueError("No response found from complete_document.")
        
        langfuse.update_current_trace(
            output={"result": result}
        )
        
        return GenerationResult(generation_type=prompt_name, result=result, extra_data={})

    # If falseContextData is none/empty, use baseline behavior
    if not doc_context.falseContextData:
        langfuse.update_current_trace(
            metadata={"execution_mode": "baseline"}
        )
        
        full_prompt = get_full_prompt(prompt_name, doc_context)
        if DEBUG_PROMPTS:
            print(f"Prompt for {prompt_name} (baseline):\n{full_prompt}\n")
        
        completion = await openai_client.chat.completions.parse(
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
        if not suggestion_response or not suggestion_response.responses:
            raise ValueError("No suggestions found in the response.")
        
        markdown_response = "\n\n".join(
            [f"- {item}" for item in suggestion_response.responses]
        )
        
        langfuse.update_current_trace(
            output={
                "result": markdown_response,
                "suggestions": suggestion_response.responses
            }
        )
        
        return GenerationResult(
            generation_type=prompt_name, result=markdown_response, extra_data={}
        )

    # Study mode: parallel calls with mixing
    langfuse.update_current_trace(
        metadata={"execution_mode": "study_mode_with_mixing"}
    )
    
    true_suggestions_task = _get_suggestions_from_context(
        prompt_name, doc_context, use_false_context=False
    )
    false_suggestions_task = _get_suggestions_from_context(
        prompt_name, doc_context, use_false_context=True
    )

    # Execute both calls in parallel
    true_suggestions, false_suggestions = await asyncio.gather(
        true_suggestions_task, false_suggestions_task
    )

    if len(true_suggestions) == 0 or len(false_suggestions) == 0:
        # One or both of the queries refused.
        langfuse.update_current_trace(
            metadata={"refusal": True}
        )
        return GenerationResult(generation_type=prompt_name, result="", extra_data={})

    if len(true_suggestions) != 3 or len(false_suggestions) != 3:
        raise ValueError("Unexpected number of suggestions returned.")

    # Create seed from request body hash for repeatable shuffling
    request_body = {
        "prompt_name": prompt_name,
        "beforeCursor": doc_context.beforeCursor,
        "selectedText": doc_context.selectedText,
        "afterCursor": doc_context.afterCursor,
        "contextData": [
            {"title": s.title, "content": s.content} for s in doc_context.contextData
        ]
        if doc_context.contextData
        else None,
        "falseContextData": [
            {"title": s.title, "content": s.content}
            for s in doc_context.falseContextData
        ]
        if doc_context.falseContextData
        else None,
    }
    request_hash = hashlib.sha256(
        json.dumps(request_body, sort_keys=True).encode()
    ).hexdigest()
    shuffle_seed = int(request_hash[:8], 16)

    # Combine and shuffle suggestions
    all_suggestions = []
    for i, suggestion in enumerate(true_suggestions):
        all_suggestions.append(
            {"content": suggestion, "source": "true", "original_index": i}
        )
    for i, suggestion in enumerate(false_suggestions):
        all_suggestions.append(
            {"content": suggestion, "source": "false", "original_index": i}
        )

    # Shuffle with deterministic seed
    random.seed(shuffle_seed)

    # Ensure that the 3 selected suggestions include at least 1 true and 1 false
    while True:
        random.shuffle(all_suggestions)
        selected_suggestions = all_suggestions[:3]
        if len(set(item["source"] for item in selected_suggestions)) > 1:
            break

    # Create markdown response
    markdown_response = "\n\n".join(
        [f"- {item['content']}" for item in selected_suggestions]
    )

    # Create metadata for logging
    extra_data = {
        "shuffle_seed": shuffle_seed,
        "request_hash": request_hash,
        "suggestion_sources": [
            {
                "content": item["content"],
                "source": item["source"],
                "original_index": item["original_index"],
            }
            for item in selected_suggestions
        ],
        "total_true_suggestions": sum(
            1 for item in selected_suggestions if item["source"] == "true"
        ),
        "total_false_suggestions": sum(
            1 for item in selected_suggestions if item["source"] == "false"
        ),
    }
    
    # Add mixing results to trace metadata
    langfuse.update_current_trace(
        metadata={
            "mixing_stats": {
                "true_count": extra_data["total_true_suggestions"],
                "false_count": extra_data["total_false_suggestions"],
                "shuffle_seed": shuffle_seed
            }
        },
        output={
            "result": markdown_response,
            "suggestions": [item["content"] for item in selected_suggestions],
            "sources": [item["source"] for item in selected_suggestions]
        }
    )

    return GenerationResult(
        generation_type=prompt_name, result=markdown_response, extra_data=extra_data
    )


def obscure(token):
    word = token.text
    return "·" * len(word) + token.whitespace_


async def chat(
    messages: Iterable[ChatCompletionMessageParam], temperature: float
) -> str:
    response = await openai_client.chat.completions.create(
        **MODEL_PARAMS,
        messages=messages,
        max_tokens=1024,
    )

    result = response.choices[0].message.content
    return result or ""


def chat_stream(messages: Iterable[ChatCompletionMessageParam], temperature: float):
    return openai_client.chat.completions.create(
        **MODEL_PARAMS,
        messages=messages,
        max_tokens=1024,
        stream=True,
    )


@observe(name="reflection", as_type="generation")
async def reflection(userDoc: str, paragraph: str) -> GenerationResult:
    temperature = 1.0
    
    langfuse = get_client()
    langfuse.update_current_observation(
        metadata={
            "temperature": temperature,
            "generation_type": "reflection"
        }
    )

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
        },
    )