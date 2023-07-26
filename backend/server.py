import json
import os
import sqlite3

import openai
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from nlp import (
    get_completion_reflections,
    gen_reflections_chat,
    fix_json_chat,
)

# Read env file
with open(".env", "r") as f:
    for line in f:
        key, value = line.split("=")
        os.environ[key] = value.strip()

openai.organization = "org-9bUDqwqHW2Peg4u47Psf9uUo"
openai.api_key = os.getenv("OPENAI_API_KEY")


class ReflectionRequestPayload(BaseModel):
    user_id: str
    paragraph: str
    prompt: str
    


class ReflectionResponseItem(BaseModel):
    text_in_HTML_format: str
    sentence_number_in_paragraph: int
    quality: float


class ReflectionResponses(BaseModel):
    reflections: List[ReflectionResponseItem]


class FeedbackPayload(BaseModel):
    user_id: str
    paragraph: str
    prompt: str
    feedback_type: str  # "Upvote" or "Reject"
    




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
        "CREATE TABLE IF NOT EXISTS requests (timestamp, user_id, prompt, paragraph, response, success)"
    )
    c.execute(
        "CREATE TABLE IF NOT EXISTS feedback_logs (timestamp,user_id, prompt, paragraph, feedback_type)"
    )


async def get_reflections_chat(request: ReflectionRequestPayload) -> ReflectionResponses:
    # Check if this request has been made before
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute(
            "SELECT response FROM requests WHERE prompt=? AND paragraph=? AND success='true'",
            ( request.user_id, request.prompt, request.paragraph),
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
                    ( request.user_id, request.prompt, request.paragraph, json.dumps(dict(
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
            ( request.user_id, request.prompt, request.paragraph, json.dumps(
                reflection_items.dict()), "true"),
        )

    return reflection_items


@app.post("/reflections")
async def reflections(payload: ReflectionRequestPayload, request: Request):
    user_id = payload.user_id
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


@app.post("/log_feedback")
async def log_feedback(payload: FeedbackPayload, request: Request):
    user_id = payload.user_id
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        # Use SQL timestamp
        c.execute(
            'INSERT INTO feedback_logs VALUES (datetime("now"), ?, ?, ?)',
            (payload.prompt, payload.paragraph, payload.feedback_type, payload.user_id),
        )

    return {"message": "Feedback logged successfully"}


uvicorn.run(app, port=8000)

