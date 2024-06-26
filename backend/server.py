import os
import json
import sqlite3

import openai
import uvicorn

from typing import List, Dict, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
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

ENABLE_GEMMA = os.getenv("ENABLE_GEMMA", "false").lower() == "true"


# Lifespan events for LLMs
from contextlib import asynccontextmanager
ml_models = {}

@asynccontextmanager
async def models_lifespan(app: FastAPI):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM

    model_name = 'google/gemma-1.1-7b-it'

    if ENABLE_GEMMA:
        ml_models["gemma"] = gemma = {
            'tokenizer': AutoTokenizer.from_pretrained(model_name),
            'model': AutoModelForCausalLM.from_pretrained(model_name, device_map="auto", torch_dtype=torch.bfloat16)#quantization_config=quantization_config)
        }
        print("Loaded Gemma with device map:")
        print(gemma['model'].hf_device_map)

    yield

    # Release resources on exit
    ml_models.clear()


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

app = FastAPI(lifespan=models_lifespan)

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


@app.get("/api/highlights")
def get_highlights(doc: str, prompt: Optional[str] = None, updated_doc: Optional[str] = ''):
    ''' Example of using this in JavaScript:
    
    let url = new URL('http://localhost:8000/api/highlights')
    url.searchParams.append('doc', 'This is a test document. It is a test document because it is a test document.')
    url.searchParams.append('prompt', 'Rewrite this document to be more concise.')
    url.searchParams.append('updated_doc', 'This is a test document.')
    let response = await fetch(url)
    '''
    if not ENABLE_GEMMA:
        raise HTTPException(status_code=404, detail="This service is not enabled.")

    import torch

    gemma = ml_models['gemma']
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

    if updated_doc is None or len(updated_doc.strip()) == 0:
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


@app.get('/api/next_token')
def get_next_token_predictions(original_doc: str,
                               prompt: str,
                               doc_in_progress: str,
                               k: Optional[int] = 5):
    if not ENABLE_GEMMA:
        raise HTTPException(status_code=404, detail="This service is not enabled.")

    import torch

    model = ml_models['gemma']['model']
    tokenizer = ml_models['gemma']['tokenizer']

    messages = [
        {
            "role": "user",
            "content": f"{prompt}\n\n{original_doc}",
        },
    ]
    tokenized_chat = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")[0]

    doc_in_progress_ids = tokenizer(doc_in_progress, return_tensors='pt')['input_ids'][0]

    # strip the first token, the "beginning of document" token
    doc_in_progress_ids = doc_in_progress_ids[1:]

    joined_ids = torch.cat([tokenized_chat, doc_in_progress_ids])
    hypotheses = joined_ids[None].to(model.device)

    # For each of the k next tokens, generate most-likely next tokens and append back on until we
    # reach a token with a space

    with torch.no_grad():
        model_outs = model(hypotheses, output_hidden_states=True)

    next_token_logits = model_outs.logits[0, -1]
    branch_tokens = next_token_logits.topk(k).indices

    # Now call the model again, passing the kv cache, so we can continue generating.
    # Each of the k next tokens will be considered as one sequence in a "batch".
    next_tokens_as_batch = branch_tokens.unsqueeze(1)
    assert next_tokens_as_batch.shape == (k, 1)

    # We need to duplicate the kv cache for each of the k next tokens
    kv_cache = [
        (key.repeat_interleave(k, dim=0), value.repeat_interleave(k, dim=0))
        for key, value in model_outs.past_key_values
    ]

    with torch.no_grad():
        model_outs = model(next_tokens_as_batch, past_key_values=kv_cache, output_hidden_states=True)
    
    # Grab the single most likely token from each of the k sequences
    next_token_logits = model_outs.logits[:, -1]
    assert next_token_logits.shape == (k, tokenizer.vocab_size)
    most_likely_token_ids = next_token_logits.argmax(dim=-1)

    # Stick them at the end of the branch tokens.
    assert most_likely_token_ids.shape == (k,)
    lookahead_sequences = torch.cat([
        branch_tokens.unsqueeze(1),
        most_likely_token_ids.unsqueeze(1)
    ], dim=1)
    assert lookahead_sequences.shape == (k, 2)

    return {
        'next_tokens': tokenizer.batch_decode(lookahead_sequences)
    }


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
