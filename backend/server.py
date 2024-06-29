import os
import json
import random
import sqlite3

from openai import AsyncOpenAI
import uvicorn

import spacy

from typing import List, Dict, Optional
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from pydantic import BaseModel
from dotenv import load_dotenv

# Load ENV vars
load_dotenv()

LOG_PATH = Path("./logs").absolute()

MODEL_NAME = "gpt-4o"
DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or 8000)

# Create OpenAI client
openai_api_key = (os.getenv("OPENAI_API_KEY") or "").strip()

if openai_api_key == "":
    raise Exception("OPENAI_API_KEY is not set. Please set it in a .env file.")

openai_client = AsyncOpenAI(
    api_key=openai_api_key,
)


# Load spaCy model for sentence splitting
try:
    nlp = spacy.load("en_core_web_trf")
except:
    print("Need to download spaCy model. Run:")
    print("pip install spacy-transformers")
    print("python -m spacy download en_core_web_trf")
    
    exit()

# Initialize Database
db_file = "backend.db"

with sqlite3.connect(db_file) as conn:
    c = conn.cursor()

    c.execute(
        "CREATE TABLE IF NOT EXISTS logs (timestamp, username, interaction, prompt, result, example)"
    )

# Declare Types
class GenerationRequestPayload(BaseModel):
    username: str
    gtype: str
    prompt: Optional[str] or Optional[List[Dict[str, str]]]

class Log(BaseModel):
    username: str
    interaction: str
    prompt: Optional[str] = None
    result: Optional[str] = None
    example: Optional[str] = None

# Initliaze Server
app = FastAPI()

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes

@app.post("/api/generation")
async def generation(payload: GenerationRequestPayload):
    if payload.gtype == "chat":
        return await chat(payload.username, payload.prompt, 0.7)
    elif payload.gtype == "completion":
        return await completion(payload.username, payload.prompt)
    elif payload.gtype == "chat_completion":
        return await chat_completion(payload.username, payload.prompt)
    elif payload.gtype == "question":
        return await question(payload.username, payload.prompt)
    elif payload.gtype == "keywords":
        return await keywords(payload.username, payload.prompt)
    elif payload.gtype == "structure":
        return await structure(payload.username, payload.prompt)
    else:
        return {"error": "Invalid generation type."}

@app.post("/log")
async def log_feedback(payload: Log):
    make_log(payload)

    return {"message": "Feedback logged successfully."}

# Show all server logs
@app.get("/api/logs")
async def logs():
    particpants = list(LOG_PATH.glob("*.jsonl"))
    return {
        "logs": [
            {
                "username": participant.stem,
                "logs": [json.loads(line) for line in open(participant)]
            }
            for participant in particpants
        ]
    }

def get_participant_log_filename(username):
    assert '/' not in username, 'Invalid username.'
    return LOG_PATH / f"{username}.jsonl"


# Helper functions
def make_log(payload: Log):
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()

        c.execute(
            "INSERT INTO logs (timestamp, username, interaction, prompt, result, example) "
            "VALUES (datetime('now'), ?, ?, ?, ?, ?)",
            (payload.username, payload.interaction,
             payload.prompt, payload.result, payload.example),
        )
    
    with open(get_participant_log_filename(payload.username), "a+") as f:
        f.write(json.dumps(payload.model_dump()) + "\n")


def is_full_sentence(sentence):
    sentence += " AND"

    # Concatenating " AND" to the text will result in 2 segments if the text is a complete sentence.
    num_segments = len(list(nlp(sentence).sents))

    return num_segments > 1

def obscure(token):
    word = token.text
    return '·' * len(word) + token.whitespace_

async def chat(username: str, messages: List[Dict[str, str]], temperature: float):
    response = await openai_client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        temperature=temperature,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0
    )

    result = response.choices[0].message.content

    make_log(
        Log(
            username=username,
            interaction="chat",
            prompt=messages[-1]["content"],
            result=result
        )
    )

    return result

async def completion(username: str, prompt: str):
    # Generate a completion based on the now-complete last sentence.
    response = await openai_client.completions.create(
        model="gpt-3.5-turbo-instruct",
        prompt=prompt,
        temperature=1,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stop=[".", "!", "?"]
    )

    result = response.choices[0].message.content

    make_log(
        Log(
            username=username,
            interaction="completion",
            prompt=prompt,
            result=result
        )
    )

    return result

async def chat_completion(username: str, prompt: str):
    # 15 is about the length of an average sentence. GPT"s most verbose sentences tend to be about ~30 words maximum.
    word_limit = str(random.randint(15, 30))

    # Assign prompt based on whether the document ends with a space for a new paragraph
    if (prompt[-1] == "\r"):
        system_chat_prompt = f"You are a completion bot. For the given text, write 1 sentence to start the next paragraph. Use at least 1 and at most {word_limit} words."
    else:
        system_chat_prompt = f"You are a completion bot. For the given text, write a continuation that does not exceed one sentence. Use at least 1 and at most {word_limit} words."
    
    result = await chat(
        username=username,
        messages=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": system_chat_prompt
                    }
                ]
            },
            {
                "role": "user",
                "content": prompt
            },
        ],
        temperature=1
    )

    make_log(
        Log(
            username=username,
            interaction="chat_completion",
            prompt=prompt,
            result=result
        )
    )

    return result

async def question(username: str, prompt: str):
    example = await chat_completion(username, prompt)

    # Get the completioned sentence and the sentence right before
    completioned_paragraph = (str(prompt.strip()) + " " + example).split("\n")[-1]

    final_sentences = list(nlp(completioned_paragraph).sents)
    completioned_sentence = final_sentences[-1].text

    completion_length = len(example.split())
    max_length = max(int(completion_length * 0.8), 7)

    RHETORICAL_SITUATION = ""
    QUESTION_PROMPT = f"With the current document in mind:\n\n{prompt}\n\nWrite a question that would inspire the ideas expressed in the next given sentence. Use no more than {max_length} words."

    full_prompt = f"{RHETORICAL_SITUATION}\n{QUESTION_PROMPT}\n\n{completioned_sentence}"

    questions = await chat(
        username=username,
        messages=[
            {"role": "user", "content": full_prompt},
        ],
        temperature=1,
    )

    make_log(
        Log(
            username=username,
            interaction="question",
            prompt=str(prompt),
            result=questions,
            example=completioned_sentence
        )
    )

    return questions

async def keywords(username: str, prompt: str):
    completion = await chat_completion(username, prompt)

    KEYWORD_POS = ["NOUN", "PROPN", "VERB", "ADJ", "ADV", "INTJ"]

    # Process the text with spaCy
    doc = nlp(completion)

    # Extract the words with desired POS tags
    keywords = [
        token.text.lower() for token in doc if token.pos_ in KEYWORD_POS
    ]

    random.shuffle(keywords)

    keyword_string = ", ".join(keywords)

    make_log(
        Log(
            username=username,
            interaction="keywords",
            prompt=prompt,
            result=keyword_string
        )
    )

    return keyword_string

async def structure(username: str, prompt: str):
    completion = await chat_completion(username, prompt)

    def is_keyword(token):
        # keyword_pos = token.pos_ in ["NOUN", "PRON", "PROPN", "ADJ", "VERB"]
        # past_participle = token.tag_ == "VBN"
        # ly_word = token.text[-2:] == "ly" and token.pos_ == "ADV"
        # determiner = token.tag_ == "WDT" or token.tag_ == "IN"
        # return not determiner and (keyword_pos or past_participle or ly_word)

        plainword_tag = token.tag_ in ["IN", "CC", "EX", "WDT"]
        simple_adverb = token.tag_ in ["RB", "RBR", "RBS", "RB", "WRB"] and token.text[-2:] != "ly"
        aux = token.pos_ == "AUX"
        punct = token.pos_ == "PUNCT"

        return not (plainword_tag or punct or aux or simple_adverb)
    
    def filter(tokens):
        filtered_text = tokens[0].text_with_ws
        for token in tokens[1:]:
            if not is_keyword(token) or token.head == tokens[0]:
                if token.tag_ == "HYPH":
                    filtered_text += " "
                else:
                    filtered_text += token.text_with_ws
            else:
                filtered_text += obscure(token)

        return filtered_text.strip()

    # Process the text with spaCy
    processed_text = nlp(completion)

    # Remove words with desired POS tags and convert to str
    filtered_text = filter(processed_text)

    make_log(
        Log(
            username=username,
            interaction="structure",
            prompt=prompt,
            result=filtered_text
        )
    )

    return filtered_text.replace("· ·", "···").replace("· ·", "···")

static_path = Path("../add-in/dist")
if static_path.exists():
    @app.get("/")
    def index():
        return FileResponse(static_path / "index.html")

    # Get access to files on the server. Only for a production build.
    app.mount("", StaticFiles(directory=static_path), name="static")
else:
    print("Not mounting static files because the directory does not exist.")
    print("To build the frontend, run `npm run build` in the add-in directory.")


if __name__ == "__main__":
    uvicorn.run("server:app", host="localhost", port=PORT, reload=False)
