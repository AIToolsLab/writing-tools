import os
import json
import sqlite3

import openai
import uvicorn

from jose import jwt
from typing import List, Dict, Optional
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from sse_starlette import EventSourceResponse
from starlette.status import HTTP_403_FORBIDDEN
from urllib.request import urlopen

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

DEBUG = os.environ.get('DEBUG', "False").lower() == "true"
PORT = os.getenv("PORT") or 8000

AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN")
AUTH0_API_AUDIENCE = os.getenv("AUTH0_API_AUDIENCE")

# Auth0 Bearer Token comes over HTTP Authorization header

token_auth_scheme = HTTPBearer()

# Declare Types
class ReflectionRequestPayload(BaseModel):
    username: str
    paragraph: str
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


# from https://auth0.com/docs/quickstart/backend/python/01-authorization#validate-access-tokens
def verify_token(token: HTTPAuthorizationCredentials = Depends(token_auth_scheme)):
    jsonurl = urlopen(f"https://{AUTH0_DOMAIN}/.well-known/jwks.json")
    jwks = json.loads(jsonurl.read())
    print(token.credentials)
    unverified_header = jwt.get_unverified_header(token.credentials)
    rsa_key = {}
    for key in jwks["keys"]:
        if key["kid"] == unverified_header["kid"]:
            rsa_key = {
                "kty": key["kty"],
                "kid": key["kid"],
                "use": key["use"],
                "n": key["n"],
                "e": key["e"]
            }
    if rsa_key:
        try:
            payload = jwt.decode(
                token.credentials,
                rsa_key,
                algorithms=["RS256"],
                audience=AUTH0_API_AUDIENCE,
                issuer=f"https://{AUTH0_DOMAIN}/"
            )
            return payload

        except jwt.ExpiredSignatureError:
            raise HTTPException(
                status_code=HTTP_403_FORBIDDEN, detail="Token expired"
            )
        except jwt.JWTClaimsError:
            raise HTTPException(
                status_code=HTTP_403_FORBIDDEN, detail="Incorrect claims, please check the audience and issuer"
            )
        except Exception:
            raise HTTPException(
                status_code=HTTP_403_FORBIDDEN, detail="Unable to parse authentication token."
            )
    raise HTTPException(
        status_code=HTTP_403_FORBIDDEN, detail="Unable to find appropriate key."
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
            if chunk["choices"][0]["finish_reason"] == "stop":
                break

            yield chunk["choices"][0]["delta"]["content"]

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

@app.get("/api/private")
def private(payload: dict = Depends(verify_token)):
    """A valid access token is required to access this route"""
    return payload


# Show all server logs
@app.get("/logs")
async def logs():
    with sqlite3.connect(db_file) as conn:
        c = conn.cursor()
        c.execute("SELECT * FROM logs")
        
        result = c.fetchall()

    return result

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