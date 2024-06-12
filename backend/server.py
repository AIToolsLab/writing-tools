import os
import sqlite3

from openai import AsyncOpenAI
import uvicorn

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
    ui_id: Optional[str] = None

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
        "CREATE TABLE IF NOT EXISTS logs (timestamp, username, interaction, prompt, ui_id)"
    )

def make_log(payload: Log):
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()

        c.execute(
            "INSERT INTO logs (timestamp, username, interaction, prompt, ui_id) "
            "VALUES (datetime('now'), ?, ?, ?, ?)",
            (payload.username, payload.interaction, payload.prompt, payload.ui_id),
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

@app.post("/api/questions")
async def question(payload: CompletionRequestPayload):
    RHETORICAL_SITUATION = ''
    # QUESTION_PROMPT = 'Ask 3 specific questions based on this sentence. These questions should be able to be re-used as inspiration for writing tasks on the same topic, without having the original text on-hand, and should not imply the existence of the source text. The questions should be no longer than 20 words.'
    QUESTION_PROMPT = 'Ask a thought-provoking question in the third person about the idea expressed by the given sentence.'

    final_prefix = str(payload.prompt)

    # If the prefix is not a complete sentence, complete it first.
    if final_prefix.strip()[-1] not in ['.', '!', '?']:
        sentence_completion = (await openai_client.completions.create(
            model="gpt-3.5-turbo-instruct",
            prompt=final_prefix,
            temperature=1,
            max_tokens=1024,
            top_p=1,
            frequency_penalty=0,
            presence_penalty=0,
            stream=False,
            stop=[".", "!", "?"]
        )).choices[0].text

        final_prefix += sentence_completion + '.'

    # Generate an example based on the now-complete last sentence.    
    example = (await openai_client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt=final_prefix,
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=False,
        stop=[".", "!", "?"]
    )).choices[0].text

    # XAI: Log the example used in chain-of-thought question gen
    print(example)

    full_prompt = f'{RHETORICAL_SITUATION}\n{QUESTION_PROMPT}\n\n{example}'
    # full_prompt = f'{RHETORICAL_SITUATION}\n{QUESTION_PROMPT}\n{payload.prompt}\n<start>\n{example}\n<end>'

    questions = await openai_client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            { 'role': 'user', 'content': full_prompt },
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
        # chunk is a ChatCompletionChunk
        async for chunk in questions:
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
