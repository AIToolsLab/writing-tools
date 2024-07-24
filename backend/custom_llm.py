import argparse
import os
import json

import uvicorn

from typing import List, Dict, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from contextlib import asynccontextmanager
ml_models = {}

ENABLE_GEMMA = True

parser = argparse.ArgumentParser()
parser.add_argument("--gpu", action="store_true", help="Enable GPU usage")
args = parser.parse_args()

USE_GPU = args.gpu

@asynccontextmanager
async def models_lifespan(app: FastAPI):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM

    model_name = 'google/gemma-1.1-7b-it'

    if ENABLE_GEMMA:
        ml_models["gemma"] = gemma = {
            'tokenizer': AutoTokenizer.from_pretrained(model_name),
            'model': AutoModelForCausalLM.from_pretrained(model_name, device_map="auto" if USE_GPU else "cpu", torch_dtype=torch.bfloat16)#quantization_config=quantization_config)
        }
        print("Loaded Gemma with device map:")
        print(gemma['model'].hf_device_map)

    yield

    # Release resources on exit
    ml_models.clear()

DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or "19570")

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
    vocab_size = len(tokenizer)
    assert next_token_logits.shape == (k, vocab_size), f"{next_token_logits.shape=}, {k=}, {vocab_size=}"
    most_likely_token_ids = next_token_logits.argmax(dim=-1)

    # Stick them at the end of the branch tokens.
    assert most_likely_token_ids.shape == (k,)
    lookahead_sequences = torch.cat([
        branch_tokens.unsqueeze(1),
        most_likely_token_ids.unsqueeze(1)
    ], dim=1)
    assert lookahead_sequences.shape == (k, 2)

    return {
        'next_tokens': tokenizer.batch_decode(lookahead_sequences, skip_special_tokens=True),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="localhost", port=PORT)
