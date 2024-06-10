import re
import openai
from pydantic import BaseModel
from typing import List

client = None

def sanitize(text):
    return text.replace('"', '').replace("'", "")



# Scratch-extractor regex
# xxx\nFINAL ANSWER\nyyy
# or
# xxx\nFINAL ANSWER:\nyyy

FINAL_ANSWER_REGEX = re.compile(r"FINAL (?:ANSWER|RESPONSE|OUTPUT)(?::|\.)?\s+", re.MULTILINE)

output_format = """\
# Output format

- concise
- short phrases, not complete sentences
- not conversational
- Markdown dash (not number) format for lists.

# Task

"""

class ReflectionResponseInternal(BaseModel):
    full_response: str
    scratch: str
    reflections: List[str]

async def gen_reflections_chat(writing, prompt) -> ReflectionResponseInternal:
    prompt_with_output_format = output_format + prompt
    response = await client.chat.completions.create(
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

    full_response = response["choices"][0]["message"]["content"].strip()
    return parse_reflections_chat(full_response)


def parse_reflections_chat(full_response: str) -> ReflectionResponseInternal:
    # Make a best effort at extracting the a list of reflections from the response
    # Fall back on returning a single item.
    splits = FINAL_ANSWER_REGEX.split(full_response, maxsplit=1)
    if len(splits) > 1:
        scratch = splits[0].strip()
        final_answer = splits[1].strip()
    else:
        scratch = ""
        final_answer = full_response

    # Try to split Markdown unordered or enumerated lists into a list of reflections
    # input:
    # "- x\n- y\n- z"
    # output:
    # ["x", "y", "z"]
    reflections = re.split(r"^(?:-|\d+\.)\s+", final_answer, flags=re.MULTILINE)
    reflections = [r.strip() for r in reflections if r.strip()]
    

    # Extract the response
    return ReflectionResponseInternal(
        full_response=full_response,
        scratch=scratch,
        reflections=reflections,
    )
