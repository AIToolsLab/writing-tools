import os
import json
import random
import sqlite3

from openai import AsyncOpenAI
import uvicorn

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


# create OpenAI client
openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

if openai_api_key == "":
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

openai_client = AsyncOpenAI(
    api_key=openai_api_key,
)


# Load spaCy model for sentence splitting
# python -m spacy download en_core_web_sm
nlp = spacy.load("en_core_web_sm")


DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or "8000")

# Declare Types
class ChatRequestPayload(BaseModel):
    messages: List[Dict[str, str]]
    username: str

class CompletionRequestPayload(BaseModel):
    prompt: str

class Log(BaseModel):
    username: str
    interaction: str # "example", "question", "click"
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
            (payload.username, payload.interaction, payload.prompt, payload.result, payload.example),
        )

@app.post("/api/chat")
async def chat(payload: ChatRequestPayload):
    response = await openai_client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=payload.messages,
        temperature=0.7,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True
    )

    make_log(
        Log(username=payload.username, interaction="chat", prompt=payload.messages[-1]['content'], ui_id=None)
    )

    # Stream response
    async def generator():
        # chunk is a ChatCompletionChunk
        async for chunk in response:
            yield chunk.model_dump_json()

    return EventSourceResponse(generator())

@app.post("/api/plain-completion")
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
    if(payload.prompt[-1] == '\r'):
        system_chat_prompt = f'You are a completion bot. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words.'
    else:
        system_chat_prompt = f'You are a completion bot. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words.'
    chat_completion = (await openai_client.chat.completions.create(
        model="gpt-3.5-turbo",
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
            { 'role': 'user',
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
    uvicorn.run(app, host="localhost", port=PORT)
