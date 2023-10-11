import os
import json
import sqlite3

import openai
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

from nlp import (
    gen_reflections_chat,
    ReflectionResponseInternal
)

# Load ENV vars
load_dotenv()

openai.organization = os.getenv("OPENAI_ORGANIZATION") or "org-9bUDqwqHW2Peg4u47Psf9uUo"
openai.api_key = os.getenv("OPENAI_API_KEY")

DEBUG = os.getenv("DEBUG") or False
PORT = os.getenv("PORT") or 8000

# Declare Types
class ReflectionRequestPayload(BaseModel):
    username: str
    paragraph: str
    prompt: str

class ReflectionResponseItem(BaseModel):
    reflection: str

class ReflectionResponses(BaseModel):
    reflections: List[ReflectionResponseItem]

class ChatRequestPayload(BaseModel):
    messages: List[Dict[str, str]]
    username: str

class Log(BaseModel):
    username: str
    interaction: str # "chat", "reflection", "click", "page_change"
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
        "CREATE TABLE IF NOT EXISTS requests (timestamp, username, prompt, paragraph, response, success)"
    )
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

async def get_reflections(
    request: ReflectionRequestPayload,
) -> ReflectionResponses:
    # Check if this request has been made before
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        
        c.execute(
            "SELECT response FROM requests WHERE username=? AND prompt=? AND paragraph=? AND success='true'",
            (request.username, request.prompt, request.paragraph),
        )

        result = c.fetchone()

        if result:
            response_json = result[0]
            response = json.loads(response_json)

            # assume that the database stores only valid responses in the correct schema.
            reflections_internal = ReflectionResponseInternal(**response)
        else:
            # Else, make the request and cache the response
            reflections_internal = await gen_reflections_chat(
                writing=request.paragraph,
                prompt=request.prompt,
            )

            # Cache the response
            # Use SQL timestamp
            c.execute(
                "INSERT INTO requests (timestamp, username, prompt, paragraph, response, success) "
                "VALUES (datetime('now'), ?, ?, ?, ?, ?)",
                (request.username, request.prompt, request.paragraph, json.dumps(reflections_internal.dict()), "true"),
            )

    return ReflectionResponses(
        reflections=[
            ReflectionResponseItem(reflection=reflection)
            for reflection in reflections_internal.reflections
        ]
    )


@app.post("/api/reflections")
async def reflections(payload: ReflectionRequestPayload):
    make_log(
        Log(username=payload.username, interaction="reflection", prompt=payload.prompt, ui_id=None)
    )

    return await get_reflections(payload)

@app.post("/api/chat")
async def chat(payload: ChatRequestPayload):
    response = await openai.ChatCompletion.acreate(
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
        async for chunk in response:
            if chunk["choices"][0]["finish_reason"] == "stop":
                break

            yield chunk["choices"][0]["delta"]["content"]

    return EventSourceResponse(generator())

@app.post("/log")
async def log_feedback(payload: Log):
    make_log(payload)

    return {"message": "Feedback logged successfully."}

# Show all requests made to the server
@app.get("/requests")
async def logs():
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute("SELECT * FROM requests")
        
        result = c.fetchall()

    return result

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
