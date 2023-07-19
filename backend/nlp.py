import re
import openai
from tenacity import (
    retry, stop_after_attempt,  # for exponential backoff
    wait_random_exponential
)
from pydantic import BaseModel
from typing import List


# ! Look at prompt and guidance/jsonformer
DEFAULT_COMPLETION_PROMPT = """
You are a writing assistant. Your purpose is to ask the writer helpful and thought-provoking reflections to help them think of how to improve their writing. For each question, include the phrase from the paragraph that it applies to. You must writing your reflections in the following JSON format:

```json
        {
        "reflections": [
                {
                    "question": "{{gen 'question'}}",
                    "phrase": "{{gen 'phrase'}}"
                },
            ]
        }
```

Create 5 reflections for the following piece of writing using the JSON format above.
"""

def sanitize(text):
    return text.replace('"', '').replace("'", "")


async_chat_with_backoff = (
    retry(wait=wait_random_exponential(
        min=1, max=60), stop=stop_after_attempt(6))
    (openai.ChatCompletion.acreate)
)


def get_completion_reflections(writing, prompt=DEFAULT_COMPLETION_PROMPT):
    completion_prompt = prompt + writing + "\n\n ```json \n"

    response = openai.Completion.create(
        model="text-davinci-003",
        prompt=completion_prompt,
        temperature=0.7,
        max_tokens=256,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        echo=True,
    )

    return response["choices"][0]["text"].split("```json")[2]


# Scratch-extractor regex
# xxx\nFINAL ANSWER\nyyy
# or
# xxx\nFINAL ANSWER:\nyyy

FINAL_ANSWER_REGEX = re.compile(r"FINAL (?:ANSWER|RESPONSE|OUTPUT)(?::)?\n", re.MULTILINE)

class ReflectionResponseInternal(BaseModel):
    full_response: str
    scratch: str
    reflections: List[str]

async def gen_reflections_chat(writing, prompt) -> ReflectionResponseInternal:
    response = await async_chat_with_backoff(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": sanitize(writing)},
        ],
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
    )

    # Make a best effort at extracting the a list of reflections from the response
    # Fall back on returning a single item.
    full_response = response["choices"][0]["message"]["content"].strip()
    splits = FINAL_ANSWER_REGEX.split(full_response, maxsplit=1)
    if len(splits) > 1:
        scratch = splits[0].strip()
        final_answer = splits[1].strip()
    else:
        scratch = ""
        final_answer = full_response

    # Try to split a dash list into a list of reflections
    # input:
    # "- x\n- y\n- z"
    # output:
    # ["x", "y", "z"]
    reflections = re.split(r"^-\s+", final_answer, flags=re.MULTILINE)
    reflections = [r.strip() for r in reflections if r.strip()]
    

    # Extract the response
    return ReflectionResponseInternal(
        full_response=full_response,
        scratch=scratch,
        reflections=reflections,
    )

async def fix_json_chat(invalid_json):
    # Ask the LM to fix the JSON.
    response = await openai.ChatCompletion.acreate(
        model="gpt-3.5-turbo",
        messages=[
            {
                "role": "system",
                "content":
                    "The JSON should be an array of items with the following schema:\n\n"
                        + DESIRED_SCHEMA
            },
            {"role": "user", "content": invalid_json},
        ],
        temperature=.5,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
    )

    return response["choices"][0]["message"]["content"]
