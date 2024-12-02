import argparse
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from transformers import AutoModelForCausalLM, AutoTokenizer

from custom_llm_inference import get_highlights_inner, get_next_token_predictions_inner

ml_models = {}

parser = argparse.ArgumentParser()
parser.add_argument("--gpu", action="store_true", help="Enable GPU usage")
args = parser.parse_args()

USE_GPU = args.gpu

if not USE_GPU:
    print("Running without GPU. To enable GPU, run with the --gpu flag.")

@asynccontextmanager
async def models_lifespan(app: FastAPI):

    #model_name = 'google/gemma-1.1-7b-it'
    model_name = 'google/gemma-1.1-2b-it'

    dtype = torch.bfloat16 if USE_GPU else torch.float16

    ml_models["llm"] = llm = {
        'tokenizer': AutoTokenizer.from_pretrained(model_name),
        'model': AutoModelForCausalLM.from_pretrained(model_name, device_map="auto" if USE_GPU else "cpu", torch_dtype=dtype)#quantization_config=quantization_config)
    }
    print("Loaded llm with device map:")
    print(llm['model'].hf_device_map)

    # Print timing info for each endpoint
    print("\nRunning endpoint tests...")
    
    test_doc = "This is a test document that needs to be revised for clarity and conciseness."
    test_prompt = "Make this more clear and concise."
    
    client = TestClient(app)
    
    start = time.time()
    response = client.get("/api/highlights", 
        params={"doc": test_doc, "prompt": test_prompt})
    print(f"Highlights endpoint: {time.time() - start:.2f}s")
    
    start = time.time()
    response = client.get("/api/next_token",
        params={"original_doc": test_doc, "prompt": test_prompt, "doc_in_progress": "This is"})
    print(f"Next token endpoint: {time.time() - start:.2f}s")
    
    # start = time.time()
    # response = client.get("/api/gen_revisions",
    #     params={"doc": test_doc, "prompt": test_prompt, "n": 1})
    # print(f"Gen revisions endpoint: {time.time() - start:.2f}s")

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
def get_highlights(doc: str, prompt: Optional[str] = None, updated_doc: Optional[str] = '', k: Optional[int] = 5):
    ''' Example of using this in JavaScript:
    
    let url = new URL('http://localhost:8000/api/highlights')
    url.searchParams.append('doc', 'This is a test document. It is a test document because it is a test document.')
    url.searchParams.append('prompt', 'Rewrite this document to be more concise.')
    url.searchParams.append('updated_doc', 'This is a test document.')
    let response = await fetch(url)
    '''

    llm = ml_models['llm']
    model = llm['model']
    tokenizer = llm['tokenizer']

    if prompt is None:
        prompt = "Rewrite this document to be more concise."

    highlights = get_highlights_inner(model, tokenizer, doc, prompt, updated_doc, k)

    return {'highlights': highlights}


@app.get('/api/next_token')
def get_next_token_predictions(original_doc: str,
                               prompt: str,
                               doc_in_progress: str,
                               k: Optional[int] = 5):


    model = ml_models['llm']['model']
    tokenizer = ml_models['llm']['tokenizer']

    decoded_next_tokens, next_token_logits = get_next_token_predictions_inner(
        model, tokenizer, original_doc, prompt, doc_in_progress, k) 

    return {
        'next_tokens': decoded_next_tokens
    }


@app.get('/api/gen_revisions')
def gen_revisions(
        prompt: str,
        doc: str,
        n: Optional[int] = 5):


    model = ml_models['llm']['model']
    tokenizer = ml_models['llm']['tokenizer']

    messages = [
        {
            "role": "user",
            "content": f"{prompt}\n\n{doc}",
        },
    ]
    tokenized_chat = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt").to(model.device)

    generations = model.generate(
        tokenized_chat, num_return_sequences=n,
        max_length=1024, do_sample=True, top_k=50, top_p=0.95, temperature=0.5,
        return_dict_in_generate=True, output_scores=True)
    generated_docs = tokenizer.batch_decode(generations.sequences, skip_special_tokens=True)
    #print(generations.scores)

    # Remove prompt text. see https://github.com/huggingface/transformers/blob/v4.46.2/src/transformers/pipelines/text_generation.py#L37
    prompt_length = len(
        tokenizer.decode(
            tokenized_chat[0],
            skip_special_tokens=True,
            clean_up_tokenization_spaces=True,
    ))

    return {
        'revised_docs': [dict(doc_text=doc[prompt_length:]) for doc in generated_docs]
    }


if __name__ == "__main__":
    uvicorn.run(app, host="localhost", port=PORT)
