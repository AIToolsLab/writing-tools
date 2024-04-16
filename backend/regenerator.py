import streamlit as st

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForCausalLM
import pandas as pd

model_options = [
    'API',
    'google/gemma-1.1-2b-it',
    'google/gemma-1.1-7b-it'
]

model_name = st.selectbox("Select a model", model_options + ['other'])

if model_name == 'other':
    model_name = st.text_input("Enter model name", model_options[0])

@st.cache_resource
def get_tokenizer(model_name):
    return AutoTokenizer.from_pretrained(model_name).from_pretrained(model_name)

@st.cache_resource
def get_model(model_name):
    model = AutoModelForCausalLM.from_pretrained(model_name, device_map='auto', torch_dtype=torch.bfloat16)
    print(f"Loaded model, {model.num_parameters():,d} parameters.")
    return model

prompt = st.text_area("Prompt", "Rewrite this document to be more clear and concise.")
doc = st.text_area("Document", "This is a document that I would like to have rewritten to be more concise.")


def get_spans_local(prompt, doc):
    tokenizer = get_tokenizer(model_name)
    model = get_model(model_name)


    messages = [
        {
            "role": "user",
            "content": f"{prompt}\n\n{doc}",
        },
    ]
    tokenized_chat = tokenizer.apply_chat_template(messages, tokenize=True, add_generation_prompt=True, return_tensors="pt")[0]
    assert len(tokenized_chat.shape) == 1

    doc_ids = tokenizer(doc, return_tensors='pt')['input_ids'][0]
    joined_ids = torch.cat([tokenized_chat, doc_ids[1:]])

    # Call the model
    with torch.no_grad():
        logits = model(joined_ids[None].to(model.device)).logits[0].cpu()

    spans = []
    length_so_far = 0
    for idx in range(len(tokenized_chat), len(joined_ids)):
        probs = logits[idx - 1].softmax(dim=-1)
        token_id = joined_ids[idx]
        token = tokenizer.decode(token_id)
        token_loss = -probs[token_id].log().item()
        most_likely_token_id = probs.argmax()
        print(idx, token, token_loss, tokenizer.decode(most_likely_token_id))
        spans.append(dict(
            start=length_so_far,
            end=length_so_far + len(token),
            token=token,
            token_loss=token_loss,
            most_likely_token=tokenizer.decode(most_likely_token_id)
        ))
        length_so_far += len(token)
    return spans

def get_highlights_api(prompt, doc):
    # Make a request to the API. prompt and doc are query parameters:
    # https://tools.kenarnold.org/api/highlights?prompt=Rewrite%20this%20document&doc=This%20is%20a%20document
    # The response is a JSON array
    import requests
    response = requests.get("https://tools.kenarnold.org/api/highlights", params=dict(prompt=prompt, doc=doc))
    return response.json()['highlights']

if model_name == 'API':
    spans = get_highlights_api(prompt, doc)
else:
    spans = get_spans_local(prompt, doc)

highest_loss = max(span['token_loss'] for span in spans[1:])
for span in spans:
    span['loss_ratio'] = span['token_loss'] / highest_loss

html = ''
for span in spans:
    b = int(256 * span["token_loss"] / highest_loss)
    html += f'<span style="color: rgba(128, 128, {b:d})" title="{span["most_likely_token"]}">{span["token"]}</span>'
html = f"<p style=\"background: white;\">{html}</p>"

st.subheader("Rewritten document")
st.write(html, unsafe_allow_html=True)
st.write(pd.DataFrame(spans)[['token', 'token_loss', 'most_likely_token', 'loss_ratio']])
