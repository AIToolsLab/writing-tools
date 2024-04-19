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

if openai.api_key is None:
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or "8000")

# Declare Types
class ReflectionRequestPayload(BaseModel):
    username: str
    paragraph: str # TODO: update name
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
            yield json.dumps(chunk)

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

gemma = {
    'model': None,
    'tokenizer': None
}


@app.get("/api/highlights")
def get_highlights(doc: str, prompt: Optional[str] = None, updated_doc: Optional[str] = ''):
    ''' Example of using this in JavaScript:
    
    let url = new URL('http://localhost:8000/api/highlights')
    url.searchParams.append('doc', 'This is a test document. It is a test document because it is a test document.')
    url.searchParams.append('prompt', 'Rewrite this document to be more concise.')
    url.searchParams.append('updated_doc', 'This is a test document.')
    let response = await fetch(url)
    '''

    import torch
    # load Gemma
    if gemma['model'] is None:
        from transformers import AutoTokenizer, AutoModelForCausalLM
        # Load the model
        model_name = 'google/gemma-1.1-7b-it'
        gemma['tokenizer'] = tokenizer = AutoTokenizer.from_pretrained(model_name)
        gemma['model'] = model = AutoModelForCausalLM.from_pretrained(model_name, device_map='auto', torch_dtype=torch.bfloat16)
    
    model = gemma['model']
    tokenizer = gemma['tokenizer']

    if prompt is None:
        prompt = "Rewrite this document to be more concise."

    messages = [
        {
            "role": "user",
            "content": f"{prompt}\n\n{doc}",
        },
    ]
    tokenized_chat = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")[0]
    assert len(tokenized_chat.shape) == 1

    if len(updated_doc.strip()) == 0:
        updated_doc = doc
    updated_doc_ids = tokenizer(updated_doc, return_tensors='pt')['input_ids'][0]

    joined_ids = torch.cat([tokenized_chat, updated_doc_ids[1:]])
    # Call the model
    with torch.no_grad():
        logits = model(joined_ids[None].to(model.device)).logits[0].cpu()
    
    highlights = []
    length_so_far = 0
    for idx in range(len(tokenized_chat), len(joined_ids)):
        probs = logits[idx - 1].softmax(dim=-1)
        token_id = joined_ids[idx]
        token = tokenizer.decode(token_id)
        token_loss = -probs[token_id].log().item()
        most_likely_token_id = probs.argmax()
        #print(idx, token, token_loss, tokenizer.decode(most_likely_token_id))
        highlights.append(dict(
            start=length_so_far,
            end=length_so_far + len(token),
            token=token,
            token_loss=token_loss,
            most_likely_token=tokenizer.decode(most_likely_token_id)
        ))
        length_so_far += len(token)
    return {'highlights': highlights}


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
