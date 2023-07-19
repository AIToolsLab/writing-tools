import json
import os
import sqlite3
from typing import List, Dict

import openai
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from nlp import (
    get_completion_reflections,
    gen_reflections_chat,
    fix_json_chat,
    send_message
)

# Read env file
with open(".env", "r") as f:
    for line in f:
        key, value = line.split("=")
        os.environ[key] = value.strip()

openai.organization = "org-9bUDqwqHW2Peg4u47Psf9uUo"
openai.api_key = os.getenv("OPENAI_API_KEY")

class ReflectionRequestPayload(BaseModel):
    paragraph: str
    prompt: str


class ReflectionResponseItem(BaseModel):
    text_in_HTML_format: str
    sentence_number_in_paragraph: int
    quality: float

class ChatRequestPayload(BaseModel):
    message: str
    messages: List[Dict[str, str]]

class ReflectionResponses(BaseModel):
    reflections: List[ReflectionResponseItem]


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

db_file = "requests.db"

with sqlite3.connect(db_file) as conn:
    c = conn.cursor()
    c.execute(
        "CREATE TABLE IF NOT EXISTS requests (timestamp, prompt, paragraph, response, success)"
    )


async def get_reflections_chat(
    request: ReflectionRequestPayload,
) -> ReflectionResponses:
    # Check if this request has been made before
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute(
            "SELECT response FROM requests WHERE prompt=? AND paragraph=? AND success='true'",
            (request.prompt, request.paragraph),
        )
        result = c.fetchone()

        if result:
            response_json = result[0]
            response = json.loads(response_json)
            # assume that the database stores only valid responses in the correct schema.
            # We check this below.
            return ReflectionResponses(**response)

    # Else, make the request and cache the response
    response = await gen_reflections_chat(
        writing=request.paragraph,
        prompt=request.prompt
    )

    # Attempt to parse JSON
    try:
        response_json = json.loads(response)
        reflection_items = ReflectionResponses(**response_json)
    except Exception as e1:
        new_response = await fix_json_chat(response)

        # Try to parse again
        try:
            response_json = json.loads(new_response)
            reflection_items = ReflectionResponses(**response_json)
        except Exception as e2:
            # If it still doesn't work, log the error and fail out
            with sqlite3.connect(db_file) as conn:
                c = conn.cursor()
                # Use SQL timestamp
                c.execute(
                    'INSERT INTO requests VALUES (datetime("now"), ?, ?, ?, ?)',
                    (request.prompt, request.paragraph, json.dumps(dict(
                        error=str(e2),
                        response=response
                    )), "false"),
                )

            raise e2

    # Cache the response
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        # Use SQL timestamp
        c.execute(
            'INSERT INTO requests VALUES (datetime("now"), ?, ?, ?, ?)',
            (request.prompt, request.paragraph, json.dumps(
                reflection_items.dict()), "true"),
        )

    return reflection_items


@app.post("/reflections")
async def reflections(payload: ReflectionRequestPayload):
    api = "chat"

    if api == "chat":
        return await get_reflections_chat(payload)
    elif api == "completions":
        # TODO: Update completion method
        return get_completion_reflections(writing=payload.paragraph, prompt=payload.prompt)


@app.post("/chat")
async def chat(payload: ChatRequestPayload):
    return await send_message(
        message=payload.message,
        messages=payload.messages
    )

@app.get("/logs")
async def logs():
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute("SELECT * FROM requests")
        result = c.fetchall()

    return result

uvicorn.run(app, port=8000)
