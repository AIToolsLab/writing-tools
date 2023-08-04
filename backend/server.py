import json
import sqlite3

from typing import List, Dict

from pathlib import Path

import openai
import uvicorn

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from nlp import (
    gen_reflections_chat,
    ReflectionResponseInternal
)

openai.organization = "org-9bUDqwqHW2Peg4u47Psf9uUo"

DEBUG = False
PORT = 8000

# Read env file
with open(".env", "r") as f:
    for line in f:
        key, value = line.split("=")
        if key == "OPENAI_API_KEY":
            openai.api_key = value.strip()
        elif key == "OPENAI_ORGANIZATION":
            openai.organization = value.strip()
        elif key == "DEBUG":
            DEBUG = value.strip().lower() == "true"
        elif key == "PORT":
            PORT = int(value.strip())

class ReflectionRequestPayload(BaseModel):
    user_id: int
    paragraph: str
    prompt: str


class ReflectionResponseItem(BaseModel):
    reflection: str

class ChatRequestPayload(BaseModel):
    messages: List[Dict[str, str]]

class ReflectionResponses(BaseModel):
    reflections: List[ReflectionResponseItem]

class FeedbackLog(BaseModel):
    user_id: int
    prompt: str
    paragraph: str
    feedback_type: str  # This can be "upvote" or "reject"


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

db_file = "logs.db"

with sqlite3.connect(db_file) as conn:
    c = conn.cursor()
    c.execute(
        "CREATE TABLE IF NOT EXISTS requests (timestamp, user_id, prompt, paragraph, response, success)"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS feedback_logs (timestamp, user_id, prompt, paragraph, feedback_type)"
     )

async def get_reflections_chat(
    request: ReflectionRequestPayload,
) -> ReflectionResponses:
    # Check if this request has been made before
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute(
            "SELECT response FROM requests WHERE user_id=? AND prompt=? AND paragraph=? AND success='true'",
            (request.user_id, request.prompt, request.paragraph),
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
                prompt=request.prompt
            )

            # Cache the response
            # Use SQL timestamp
            c.execute(
                'INSERT INTO requests (timestamp, user_id, prompt, paragraph, response, success) '
                'VALUES (datetime("now"), ?, ?, ?, ?, ?)',
                (request.user_id, request.prompt, request.paragraph, json.dumps(reflections_internal.dict()), "true"),
            )

    return ReflectionResponses(
        reflections=[
            ReflectionResponseItem(reflection=reflection)
            for reflection in reflections_internal.reflections
        ]
    )


@app.post("/api/reflections")
async def reflections(payload: ReflectionRequestPayload):
    return await get_reflections_chat(payload)

from sse_starlette import EventSourceResponse

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

    async def generator():
        async for chunk in response:
            if chunk["choices"][0]["finish_reason"] == "stop":
                break
            delta = chunk["choices"][0]["delta"]
            yield json.dumps(delta)

    return EventSourceResponse(generator())

@app.get("/logs")
async def logs():
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute("SELECT * FROM requests")
        result = c.fetchall()

    return result

@app.post("/feedback")
async def log_feedback(payload: FeedbackLog):
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute(
            "INSERT INTO feedback_logs (timestamp, user_id, prompt, paragraph, feedback_type) "
            "VALUES (datetime('now'), ?, ?, ?, ?)",
            (payload.user_id, payload.prompt, payload.paragraph, payload.feedback_type),
        )
    return {"message": "Feedback logged successfully."}

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
