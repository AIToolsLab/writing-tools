import openai
from tenacity import (
    retry, stop_after_attempt,  # for exponential backoff
    wait_random_exponential
)

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

DESIRED_SCHEMA = '''
interface Response {
    text_in_HTML_format: string;
    sentence_number_in_paragraph: number;
    quality: float between 0 and 1
}

interface Responses {
    reflections: Response[];
}
'''


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


async def gen_reflections_chat(writing, prompt):
    # TODO: improve the "quality" mechanism
    chat_prompt = """
    You will write Responses to the following prompt. JSON schema:

    """ + DESIRED_SCHEMA + """
    Prompt:

    > """ + prompt

    response = await async_chat_with_backoff(
        model="gpt-3.5-turbo",
        messages=[
            {"role": "system", "content": chat_prompt},
            {"role": "user", "content": sanitize(writing)},
        ],
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
    )

    # Extract the response
    return response["choices"][0]["message"]["content"]

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

async def send_message(messages):
    response = await openai.ChatCompletion.acreate(
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=0.7,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
    )

    return response["choices"][0]["message"]["content"]
