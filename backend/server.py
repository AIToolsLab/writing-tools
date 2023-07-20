import json
import os
import sqlite3
from typing import List

import openai
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from nlp import (
    get_completion_reflections,
    gen_reflections_chat,
    ReflectionResponseInternal
)

openai.organization = "org-9bUDqwqHW2Peg4u47Psf9uUo"

# Read env file
with open(".env", "r") as f:
    for line in f:
        key, value = line.split("=")
        if key == "OPENAI_API_KEY":
            openai.api_key = value.strip()
        elif key == "OPENAI_ORGANIZATION":
            openai.organization = value.strip()


class ReflectionRequestPayload(BaseModel):
    paragraph: str
    prompt: str


class ReflectionResponseItem(BaseModel):
    reflection: str


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
                'INSERT INTO requests VALUES (datetime("now"), ?, ?, ?, ?)',
                (request.prompt, request.paragraph, json.dumps(reflections_internal.dict()), "true"),
            )

    return ReflectionResponses(
        reflections=[
            ReflectionResponseItem(reflection=reflection)
            for reflection in reflections_internal.reflections
        ]
    )


@app.post("/reflections")
async def reflections(payload: ReflectionRequestPayload):
    api = "chat"

    if api == "chat":
        return await get_reflections_chat(payload)
    elif api == "completions":
        # TODO: Update completion method
        return get_completion_reflections(writing=payload.paragraph, prompt=payload.prompt)


@app.get("/logs")
async def logs():
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute("SELECT * FROM requests")
        result = c.fetchall()

    return result

if __name__ == "__main__":
    uvicorn.run(app, port=8000)
