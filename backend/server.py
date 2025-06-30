import io
import json
import logging
import os
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Annotated, Dict, List, Literal, Optional

import aiohttp
import jwt
import nlp
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Body, Depends, FastAPI, HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from pydantic import AfterValidator, BaseModel, ConfigDict
from sse_starlette.sse import EventSourceResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



# Load ENV vars
load_dotenv()

LOG_PATH = Path("./logs").absolute()

DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or 8000)

# The log secret is stored in .env file for local development.
LOG_SECRET = os.getenv("LOG_SECRET", "").strip()
print(f"Log secret: {LOG_SECRET!r}")

# JWT Configuration for Auth0
JWT_ISSUER = os.getenv("JWT_ISSUER", "https://textfocals.auth0.com/")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "textfocals.com")
DEMO_API_KEY = os.getenv("DEMO_API_KEY", "demo-key")

# Initialize HTTP Bearer security scheme
security = HTTPBearer(auto_error=False)


# Initialize HTTP Bearer security scheme
security = HTTPBearer(auto_error=False)

# Cache for JWT public keys
_jwks_cache = {}

async def get_jwks_key(kid: str) -> str:
    """Fetch and cache Auth0 public keys for JWT verification."""
    if kid in _jwks_cache:
        return _jwks_cache[kid]
    
    try:
        jwks_url = f"{JWT_ISSUER}.well-known/jwks.json"
        async with aiohttp.ClientSession() as session:
            async with session.get(jwks_url) as response:
                jwks = await response.json()
                
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                # Convert JWK to PEM format for PyJWT
                from jwt.algorithms import RSAAlgorithm
                public_key = RSAAlgorithm.from_jwk(key)
                _jwks_cache[kid] = public_key
                return public_key
                
        raise HTTPException(status_code=401, detail="Unable to find appropriate key")
    except Exception as e:
        logger.error(f"Failed to fetch JWKS: {e}")
        raise HTTPException(status_code=401, detail="Token verification failed")

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Verify JWT token and return decoded payload.
    Handles both Auth0 tokens and demo tokens.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    token = credentials.credentials
    
    # Handle demo token
    if token == "demo-access-token":
        return {
            "sub": "demo-user",
            "username": "demo",
            "iss": "demo",
            "aud": JWT_AUDIENCE,
            "is_demo": True
        }
    
    try:
        # Get token header to extract kid (key ID)
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        
        if not kid:
            raise HTTPException(status_code=401, detail="Token missing key ID")
        
        # Get the appropriate public key
        public_key = await get_jwks_key(kid)
        
        # Verify the token with signature verification
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER
        )
        
        # Basic validation
        if not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid token: missing subject")
            
        payload["is_demo"] = False
        return payload
        
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        raise HTTPException(status_code=401, detail="Token verification failed")


def should_log(username: str) -> bool:
    """
    Determines whether to log document text based on the username.
    
    Currently, production users don't have "username" flags (authentication is handled by Auth0),
    but study users have non-empty usernames.
    """
    return username != ""


def validate_username(username: str):
    if not isinstance(username, str):
        raise ValueError("Username must be a string.")
    if len(username) > 50:
        raise ValueError("Username must be 50 characters or less.")
    if not all(c.isalnum() or c in ('_', '-') for c in username):
        raise ValueError("Username must be alphanumeric or contain '_' or '-' only.")
    return username


# Declare Types
ValidatedUsername = Annotated[str, AfterValidator(validate_username)]


class GenerationRequestPayload(BaseModel):
    username: ValidatedUsername
    gtype: str
    prompt: str


class ReflectionRequestPayload(BaseModel):
    username: ValidatedUsername
    paragraph: str  # TODO: update name
    prompt: str


class ReflectionResponseItem(BaseModel):
    reflection: str


class ReflectionResponses(BaseModel):
    reflections: List[ReflectionResponseItem]


class ChatRequestPayload(BaseModel):
    messages: List[Dict[str, str]]
    username: ValidatedUsername


class Log(BaseModel):
    model_config = ConfigDict(extra='allow')
    timestamp: float
    ok: bool = True
    username: ValidatedUsername
    event: str


class GenerationLog(Log):
    generation_type: Literal["Completion", "Question", "Keywords", "Structure", "RMove"]
    prompt: str
    result: str
    completion: Optional[str] = None
    delay: float


class ReflectionLog(Log):
    paragraph: str


# Initialize Server
app = FastAPI()

origins = ["*"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    print(f"The client sent invalid data!: {exc}")
    return await request_validation_exception_handler(request, exc)



# Routes
@app.post("/api/generation")
async def generation(
    payload: GenerationRequestPayload, 
    background_tasks: BackgroundTasks,
    auth_token_data: dict = Depends(verify_token)
) -> nlp.GenerationResult:
    '''
    To test this endpoint from curl:

    $ curl -X POST -H "Content-Type: application/json" -d '{"username": "test", "gtype": "Completion", "prompt": "This is a test prompt."}' http://localhost:8000/api/generation
    '''
    should_log_doctext = should_log(payload.username)

    # Sometimes gtype will have a _Backend suffix, so we strip it out
    payload.gtype = payload.gtype.replace("_Backend", "")

    start_time = datetime.now()
    if payload.gtype == "Completion":
        result = await nlp.chat_completion(payload.prompt)
    elif payload.gtype == "Question":
        result = await nlp.question(payload.prompt)
    elif payload.gtype == "Keywords":
        result = await nlp.keywords(payload.prompt)
    elif payload.gtype == "Structure":
        result = await nlp.structure(payload.prompt)
    elif payload.gtype == "RMove":
        result = await nlp.rmove(payload.prompt)
    else:
        raise ValueError(f"Invalid generation type: {payload.gtype}")
    end_time = datetime.now()

    log_entry = GenerationLog(
        timestamp=end_time.timestamp(),
        username=payload.username,
        event="suggestion_generated",
        generation_type=payload.gtype,
        prompt=payload.prompt if should_log_doctext else "",
        result=result.result if should_log_doctext else "",
        delay=(end_time - start_time).total_seconds(),
    )
    # add on extra data
    if should_log_doctext:
        for key, value in result.extra_data.items():
            if not hasattr(log_entry, key):
                setattr(log_entry, key, value)
    background_tasks.add_task(make_log, log_entry)

    final_end_time = datetime.now()
    log = final_end_time - start_time
    logger.info(f"Total generation request operation took: {log.total_seconds()} seconds")
    return result



@app.post("/api/reflections")
async def reflections(
    payload: ReflectionRequestPayload, 
    background_tasks: BackgroundTasks,
    auth_token_data: dict = Depends(verify_token)
):
    should_log_doctext = should_log(payload.username)

    start_time = datetime.now()
    result = await nlp.reflection(userDoc=payload.prompt, paragraph=payload.paragraph)
    end_time = datetime.now()

    log_entry = ReflectionLog(
        username=payload.username,
        event="reflection_generated",
        prompt=payload.prompt if should_log_doctext else "",
        paragraph=payload.paragraph if should_log_doctext else "",
        timestamp=end_time.timestamp(),
        delay=(end_time - start_time).total_seconds(),
        result=result.result if should_log_doctext else "",
    )

    background_tasks.add_task(make_log, log_entry)

    return result


@app.post("/api/chat")
async def chat(
    payload: ChatRequestPayload,
    auth_token_data: dict = Depends(verify_token)
):
    response = await nlp.chat_stream(
        messages=payload.messages,
        temperature=0.7,
    )

    # TODO: Fix logging
    # messages_for_log = payload.messages if LOG_DOCTEXT else [{
    #     "role": message.get("role", ""),
    # } for message in payload.messages]
    # make_log(
    #    Log(username=payload.username,
    # event="chat_message",
    # prompt=payload.messages[-1]['content'],
    # ui_id=None)
    # )

    # Stream response
    async def generator():
        async for chunk in response:
            # chunk is a ChatCompletionChunk object
            yield chunk.model_dump_json()

    return EventSourceResponse(generator())


@app.post("/api/log")
async def log_feedback(payload: Log):
    await make_log(payload)

    return {"message": "Feedback logged successfully."}


class PingResponse(BaseModel):
    timestamp: datetime

# Ping: return the server's current timestamp


@app.get("/api/ping")
async def ping() -> PingResponse:
    return PingResponse(timestamp=datetime.now())


@app.get("/api/test-auth")
async def test_auth(auth_token_data: dict = Depends(verify_token)) -> dict:
    """Test endpoint to verify authentication without external dependencies"""
    return {
        "authenticated": True,
        "user_id": auth_token_data.get("sub"),
        "is_demo": auth_token_data.get("is_demo", False),
        "message": "Authentication successful"
    }


# Log viewer endpoint
class LogsPollRequest(BaseModel):
    log_positions: Dict[str, int]
    secret: str

@app.post("/api/logs_poll")
async def logs_poll(
    req: LogsPollRequest = Body(...)
):
    """
    Polling endpoint for logs. Client sends a dict of {username: num_logs_already_have}.
    Returns new log entries for each username since that count, deduplicated by timestamp+interaction+username.
    """
    log_positions = req.log_positions or {}
    secret = req.secret
    assert LOG_SECRET != "", "Logging secret not set."
    if secret != LOG_SECRET:
        return JSONResponse({"error": "Invalid secret."}, status_code=403)

    updates = []
    log_files = {participant.stem: participant for participant in LOG_PATH.glob("*.jsonl")}
    for username, log_file in log_files.items():
        if username == '.jsonl':
            continue
        with open(log_file, "r") as file:
            all_lines = file.readlines()
            # Deduplicate all entries by (timestamp, interaction, username)
            seen = set()
            deduped = []
            for line in all_lines:
                try:
                    entry = json.loads(line)
                    key = f"{entry.get('timestamp')}|{entry.get('interaction')}|{entry.get('username')}"
                    if key not in seen:
                        seen.add(key)
                        deduped.append(entry)
                except Exception:
                    continue
            # Only send entries after the client's count
            start_line = log_positions.get(username, 0)
            new_entries = deduped[start_line:]
            if new_entries:
                updates.append({
                    "username": username,
                    "logs": new_entries,
                })
    return updates


@app.get("/api/download_logs")
async def download_logs(secret: str):
    """
    Download all log files as a ZIP archive.
    """
    assert LOG_SECRET != "", "Logging secret not set."
    if secret != LOG_SECRET:
        return JSONResponse({"error": "Invalid secret."}, status_code=403)

    # Create an in-memory bytes buffer
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zipf:
        for log_file in LOG_PATH.glob("*.jsonl"):
            zipf.write(log_file, arcname=log_file.name)
    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=logs.zip"}
    )


def get_participant_log_filename(username):
    return LOG_PATH / f"{validate_username(username)}.jsonl"


async def make_log(payload: Log):
    with open(get_participant_log_filename(payload.username), "a+") as f:
        f.write(json.dumps(payload.model_dump()) + "\n")

static_path = Path("../frontend/dist")
if static_path.exists():

    @ app.get("/")
    def index():
        return FileResponse(static_path / "index.html")

    # Get access to files on the server. Only for a production build.
    app.mount("", StaticFiles(directory=static_path), name="static")
else:
    print("Not mounting static files because the directory does not exist.")
    print("To build the frontend, run `npm run build` in the frontend directory.")


if __name__ == "__main__":
    # uvicorn.run("server:app", host="localhost", port=PORT, reload=False)
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=False)
