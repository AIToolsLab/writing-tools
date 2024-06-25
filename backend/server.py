import os
import json
import random
import sqlite3

from openai import AsyncOpenAI
import uvicorn

from nltk import LancasterStemmer, PorterStemmer, SnowballStemmer
from nltk.tokenize import SyllableTokenizer
import spacy

from typing import List, Dict, Optional
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from sse_starlette import EventSourceResponse

from pydantic import BaseModel
from dotenv import load_dotenv

# Load ENV vars
load_dotenv()

MODEL_NAME = "gpt-4o"


# create OpenAI client
openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

if openai_api_key == "":
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

openai_client = AsyncOpenAI(
    api_key=openai_api_key,
)


# Load spaCy model for sentence splitting
# python -m spacy download en_core_web_sm
try:
    nlp = spacy.load("en_core_web_sm")
except:
    print("Need to download spaCy model. Run:")
    print("python -m spacy download en_core_web_sm")
    exit()


DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or "8000")

# Declare Types


class ChatRequestPayload(BaseModel):
    messages: List[Dict[str, str]]
    username: str


class CompletionRequestPayload(BaseModel):
    prompt: str
    username: str


class Log(BaseModel):
    username: str
    interaction: str  # "example", "question", "click"
    prompt: Optional[str] = None
    result: Optional[str] = None
    example: Optional[str] = None


app = FastAPI()

origins = [
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db_file = 'backend.db'

with sqlite3.connect(db_file) as conn:
    c = conn.cursor()

    c.execute(
        "CREATE TABLE IF NOT EXISTS logs (timestamp, username, interaction, prompt, result, example)"
    )


def make_log(payload: Log):
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()

        c.execute(
            "INSERT INTO logs (timestamp, username, interaction, prompt, result, example) "
            "VALUES (datetime('now'), ?, ?, ?, ?, ?)",
            (payload.username, payload.interaction,
             payload.prompt, payload.result, payload.example),
        )


def is_full_sentence(sentence):
    sentence += " AND"

    # Concatenating " AND" to the text will result in 2 segments if the text is a complete sentence.
    num_segments = len(list(nlp(sentence).sents))

    return num_segments > 1


def last_syllable(word):
    syllable_tokenizer = SyllableTokenizer()
    syllables = syllable_tokenizer.tokenize(word)
    return syllables[-1]


def obscure(token):
    word = token.text
    word = word.lower()
    stem = LancasterStemmer().stem(word)
    suffix = word[len(stem):]
    remainder = last_syllable(suffix)
    if len(remainder) > 1:
        return '·' * random.randint(4, 7) + remainder
    else:
        return '·' * random.randint(4, 7)


@app.post("/api/chat")
async def chat(payload: ChatRequestPayload):
    response = await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=payload.messages,
        temperature=0.7,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True
    )

    make_log(
        Log(username=payload.username, interaction="chat",
            prompt=payload.messages[-1]['content'], ui_id=None)
    )

    # Stream response
    async def generator():
        # chunk is a ChatCompletionChunk
        async for chunk in response:
            yield chunk.model_dump_json()

    return EventSourceResponse(generator())


@app.post("/api/completion")
async def completion(payload: CompletionRequestPayload):
    # Generate a completion based on the now-complete last sentence.
    response = await openai_client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt=payload.prompt,
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True,
        stop=[".", "!", "?"]
    )

    # Stream response
    async def generator():
        async for chunk in response:
            yield chunk.model_dump_json()

    return EventSourceResponse(generator())


@app.post("/api/chat-completion")
async def chat_completion(payload: CompletionRequestPayload):
    # 15 is about the length of an average sentence. GPT's most verbose sentences tend to be about ~30 words maximum.
    word_limit = str(random.randint(15, 30))

    # Assign prompt based on whether the document ends with a space for a new paragraph
    if (payload.prompt[-1] == '\r'):
        system_chat_prompt = f'You are a completion bot. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words.'
    else:
        system_chat_prompt = f'You are a completion bot. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words.'
    chat_completion = (await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": system_chat_prompt
                    }
                ]
            },
            {'role': 'user',
             'content': payload.prompt
             },
        ],
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True,
    ))

    # Stream response
    async def generator():
        # chunk is a ChatCompletionChunk
        async for chunk in chat_completion:
            yield chunk.model_dump_json()

    return EventSourceResponse(generator())


@app.post("/api/questions")
async def question(payload: CompletionRequestPayload):
    RHETORICAL_SITUATION = ''
    # QUESTION_PROMPT = 'Ask 3 specific questions based on this sentence. These questions should be able to be re-used as inspiration for writing tasks on the same topic, without having the original text on-hand, and should not imply the existence of the source text. The questions should be no longer than 20 words.'

    # completion = (await openai_client.completions.create(
    #     model="gpt-3.5-turbo-instruct",
    #     prompt=str(payload.prompt),
    #     temperature=1,
    #     max_tokens=1024,
    #     top_p=1,
    #     frequency_penalty=0,
    #     presence_penalty=0,
    #     stream=False,
    #     stop=[".", "!", "?"]
    # )).choices[0].text

    # Using chat completion
    # 15 is about the length of an average sentence. GPT's most verbose sentences tend to be about ~30 words maximum.
    word_limit = str(random.randint(15, 30))

    # Assign prompt based on whether the document ends with a space for a new paragraph
    if (payload.prompt[-1] == '\r'):
        system_chat_prompt = f'You are a completion bot. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words.'
    else:
        system_chat_prompt = f'You are a completion bot. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words.'
    completion = (await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": system_chat_prompt
                    }
                ]
            },
            {'role': 'user',
             'content': payload.prompt
             },
        ],
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=False,
    )).choices[0].message.content

    # Get the last sentence in the last paragraph of the document
    final_paragraph = str(payload.prompt).split('\n')[-1]
    final_sentence = list(nlp(final_paragraph).sents)[-1].text.strip()

    # If the last sentence of the document was incomplete (i.e. the completion is part of it), combine.
    if not is_full_sentence(final_sentence):
        completion = final_sentence + completion + '.'

    print(completion)

    completion_length = len(completion.split())
    max_length = max(int(completion_length*0.7), 7)

    QUESTION_PROMPT = f'Write an open-ended question answered by the given sentence\'s ideas. Use no more than {max_length} words.'

    full_prompt = f'{RHETORICAL_SITUATION}\n{QUESTION_PROMPT}\n\n{completion}'
    # full_prompt = f'{RHETORICAL_SITUATION}\n{QUESTION_PROMPT}\n{payload.prompt}\n<start>\n{example}\n<end>'

    questions = await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {'role': 'user', 'content': full_prompt},
        ],
        temperature=0.7,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True
    )

    # Stream response

    async def generator():
        full_question = ''

        # chunk is a ChatCompletionChunk
        async for chunk in questions:
            dumped = chunk.model_dump_json()
            new_chunk = json.loads(dumped)['choices'][0]['delta']['content']

            if new_chunk:
                full_question += new_chunk
            elif len(full_question):
                make_log(
                    Log(username=payload.username, interaction="question", prompt=str(
                        payload.prompt), result=full_question, example=completion)
                )

                try:
                    open(f'./logs/{payload.username}.json', 'r+')
                except:
                    with open(f'./logs/{payload.username}.json', 'a+') as f:
                        f.write(json.dumps({
                            'username': payload.username,
                            'interactions': []
                        }))

                with open(f'./logs/{payload.username}.json', 'r+') as f:
                    cur_log = json.loads(f.read())

                    new_log = {
                        'interaction': 'question',
                        'prompt': str(payload.prompt),
                        'result': full_question,
                        'example': completion
                    }

                    exists = False

                    for log in cur_log['interactions']:
                        if log['interaction'] == 'question' and log['prompt'] == str(payload.prompt) and log['result'] == full_question:
                            exists = True

                    if not exists:
                        cur_log['interactions'].append(new_log)

                with open(f'./logs/{payload.username}.json', 'w') as f:
                    f.write(json.dumps(cur_log))

            yield dumped

    return EventSourceResponse(generator())


@app.post("/api/keywords")
async def keywords(payload: CompletionRequestPayload):
    # completion = (await openai_client.completions.create(
    #     model="gpt-3.5-turbo-instruct",
    #     prompt=str(payload.prompt),
    #     temperature=1,
    #     max_tokens=1024,
    #     top_p=1,
    #     frequency_penalty=0,
    #     presence_penalty=0,
    #     stream=False,
    #     stop=[".", "!", "?"]
    # )).choices[0].text

    # Using chat completion
    # 15 is about the length of an average sentence. GPT's most verbose sentences tend to be about ~30 words maximum.
    word_limit = str(random.randint(15, 30))

    # Assign prompt based on whether the document ends with a space for a new paragraph
    if (payload.prompt[-1] == '\r'):
        system_chat_prompt = f'You are a completion bot. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words.'
    else:
        system_chat_prompt = f'You are a completion bot. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words.'
    completion = (await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": system_chat_prompt
                    }
                ]
            },
            {'role': 'user',
             'content': payload.prompt
             },
        ],
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=False,
    )).choices[0].message.content

    KEYWORD_POS = ['NOUN', 'PROPN', 'VERB', 'ADJ', 'ADV', 'INTJ']
    # Process the text with spaCy
    doc = nlp(completion)

    # Extract the words with desired POS tags
    keywords = [token.text.lower()
                for token in doc if token.pos_ in KEYWORD_POS]

    random.shuffle(keywords)

    keyword_string = ', '.join(keywords)

    return keyword_string

    # full_prompt = f'{KEYWORDS_PROMPT}\n\n{completion}'

    # keywords = await openai_client.chat.completions.create(
    #     model=MODEL_NAME,
    #     messages=[
    #         {'role': 'user', 'content': full_prompt},
    #     ],
    #     temperature=0.7,
    #     max_tokens=1024,
    #     top_p=1,
    #     frequency_penalty=0,
    #     presence_penalty=0,
    #     stream=True
    # )

    # # Stream response
    # async def generator():
    #     full_keywords = ''

    #     # chunk is a ChatCompletionChunk
    #     async for chunk in keywords:
    #         dumped = chunk.model_dump_json()
    #         new_chunk = json.loads(dumped)['choices'][0]['delta']['content']

    #         if new_chunk:
    #             full_keywords += new_chunk
    #         elif len(full_keywords):
    #             make_log(
    #                 Log(username="test", interaction="keywords", prompt=str(
    #                     payload.prompt), result=full_keywords, example=completion)
    #             )

    #         yield dumped

    # return EventSourceResponse(generator())


@app.post("/api/structure")
async def structure(payload: CompletionRequestPayload):
    # STRUCTURE_PROMPT = 'Replace informative content words with "blah" but with the same morphological endings ("s", "ing", "ize", etc.)'
    # STRUCTURE_PROMPT = 'Surround all informative words with curly braces, like {this}.'

    # completion = (await openai_client.completions.create(
    #     model="gpt-3.5-turbo-instruct",
    #     prompt=str(payload.prompt),
    #     temperature=1,
    #     max_tokens=1024,
    #     top_p=1,
    #     frequency_penalty=0,
    #     presence_penalty=0,
    #     stream=False,
    #     stop=[".", "!", "?"]
    # )).choices[0].text

    # Using chat completion
    # 15 is about the length of an average sentence. GPT's most verbose sentences tend to be about ~30 words maximum.
    word_limit = str(random.randint(15, 30))

    # Assign prompt based on whether the document ends with a space for a new paragraph
    if (payload.prompt[-1] == '\r'):
        system_chat_prompt = f'You are a completion bot. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words.'
    else:
        system_chat_prompt = f'You are a completion bot. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words.'
    completion = (await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": system_chat_prompt
                    }
                ]
            },
            {'role': 'user',
             'content': payload.prompt
             },
        ],
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=False,
    )).choices[0].message.content

    print(completion)

    # Load the English language model
    # nlp = spacy.load("en_core_web_sm")

    def non_keyword(token):
        keyword_pos = token.pos_ in ['NOUN', 'PROPN', 'ADJ', 'VERB']
        vbz = token.tag_ == 'VBZ'
        ly_word = token.text[-2:] == 'ly'
        return not (keyword_pos or ly_word) or vbz

    # Process the text with spaCy
    processedText = nlp(completion)

    # Remove words with desired POS tags
    filtered_text = ' '.join([
        token.text if non_keyword(token)
        else obscure(token)
        for token in processedText
    ])

    return filtered_text

    # # Get the last sentence in the last paragraph of the document
    # final_paragraph = str(payload.prompt).split('\n')[-1]
    # final_sentence = list(nlp(final_paragraph).sents)[-1].text

    # # If the last sentence of the document was incomplete (i.e. the completion is part of it), combine.
    # if not is_full_sentence(final_sentence):
    #     completion = final_sentence + completion + '.'

    # full_prompt = f'{STRUCTURE_PROMPT}\n\n{completion}'

    # structure = await openai_client.chat.completions.create(
    #     model=MODEL_NAME,
    #     messages=[
    #         {'role': 'user', 'content': full_prompt},
    #     ],
    #     temperature=0.7,
    #     max_tokens=1024,
    #     top_p=1,
    #     frequency_penalty=0,
    #     presence_penalty=0,
    #     stream=True
    # )

    # # Stream response
    # async def generator():
    #     full_structure = ''

    #     # chunk is a ChatCompletionChunk
    #     async for chunk in structure:
    #         dumped = chunk.model_dump_json()
    #         new_chunk = json.loads(dumped)['choices'][0]['delta']['content']

    #         if new_chunk:
    #             full_structure += new_chunk
    #         elif len(full_structure):
    #             make_log(
    #                 Log(username="test", interaction="structure", prompt=str(
    #                     payload.prompt), result=full_structure, example=completion)
    #             )

    #         yield dumped
    # return EventSourceResponse(generator())


@app.post("/log")
async def log_feedback(payload: Log):
    make_log(payload)

    return {"message": "Feedback logged successfully."}

# Show all server logs


@app.get("/logs")
async def logs():
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute("SELECT * FROM logs")

        result = c.fetchall()

    return result

static_path = Path('../add-in/dist')
if static_path.exists():
    @app.get("/")
    def index():
        return FileResponse(static_path / 'index.html')

    # Get access to files on the server. Only for a production build.
    app.mount("", StaticFiles(directory=static_path), name="static")
else:
    print("Not mounting static files because the directory does not exist.")
    print("To build the frontend, run `npm run build` in the add-in directory.")


if __name__ == "__main__":
    uvicorn.run('server:app', host="localhost", port=PORT, reload=False)
