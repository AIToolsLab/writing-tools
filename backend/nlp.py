import os
from typing import Any, Iterable, Dict

from dotenv import load_dotenv
from pydantic import BaseModel

import openai
from openai.types.chat.chat_completion_message_param import ChatCompletionMessageParam
from posthog.ai.openai import AsyncOpenAI as _WrappedAsyncOpenAI
from posthog_client import posthog_client as ph_client

MODEL_PARAMS = {
    "model": "gpt-4o",
}

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
    try:
        await dummy_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Hello"}],
        )
    except openai.APIConnectionError:
        pass


class GenerationResult(BaseModel):
    generation_type: str
    result: str
    extra_data: Dict[str, Any]



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
