import copy
import io
import json
import logging
import os
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, Dict, List, Literal

import nlp
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Body, FastAPI
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AfterValidator, BaseModel
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

    def sanitized(self):
        return GenerationRequestPayload(
            username=self.username,
            gtype=self.gtype,
            prompt="[REDACTED]"
        )


class SuggestionRequestWithDocContext(BaseModel):
    username: ValidatedUsername
    gtype: str
    doc_context: nlp.DocContext

    def sanitized(self):
        return SuggestionRequestWithDocContext(
            username=self.username,
            gtype=self.gtype,
            doc_context=nlp.DocContext(
                beforeCursor="[REDACTED]",
                afterCursor="[REDACTED]",
                selectedText=f"({len(self.doc_context.selectedText)} characters)" if self.doc_context.selectedText else "",
            )
        )


class ReflectionRequestPayload(BaseModel):
    username: ValidatedUsername
    paragraph: str  # TODO: update name
    prompt: str

    def sanitized(self):
        return ReflectionRequestPayload(
            username=self.username,
            paragraph="[REDACTED]",
            prompt="[REDACTED]"
        )


class ReflectionResponseItem(BaseModel):
    reflection: str


class ReflectionResponses(BaseModel):
    reflections: List[ReflectionResponseItem]


class ChatRequestPayload(BaseModel):
    messages: List[nlp.ChatCompletionMessageParam]
    username: ValidatedUsername


class Log(BaseModel):
    timestamp: float
    ok: bool = True
    username: ValidatedUsername
    event: str
    extra_data: Dict[str, Any] = {}


class RequestLog(Log):
    request_type: Literal["Generation", "Suggestion", "Reflection"]
    request: GenerationRequestPayload | SuggestionRequestWithDocContext | ReflectionRequestPayload
    result: str
    delay: float


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    await nlp.warmup_nlp()
    yield

app = FastAPI(lifespan=app_lifespan)

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

@app.post("/api/get_suggestion")
async def get_suggestion(payload: SuggestionRequestWithDocContext, background_tasks: BackgroundTasks) -> nlp.GenerationResult:
    should_log_doctext = should_log(payload.username)

    start_time = datetime.now()
    allowed_gtypes = list(nlp.prompts.keys())
    if payload.gtype not in allowed_gtypes:
        raise ValueError(f"Invalid generation type: {payload.gtype}")
    result = await nlp.get_suggestion(payload.gtype, payload.doc_context)
    end_time = datetime.now()

    log_entry = RequestLog(
        timestamp=end_time.timestamp(),
        username=payload.username,
        event="suggestion_generated",
        request_type="Suggestion",
        request=payload.sanitized() if not should_log_doctext else payload,
        result=result.result if should_log_doctext else f"{len(result.result)} characters REDACTED",
        delay=(end_time - start_time).total_seconds(),
    )

    background_tasks.add_task(make_log, log_entry)

    final_end_time = datetime.now()
    log = final_end_time - start_time
    logger.info(f"Total generation request operation took: {log.total_seconds()} seconds")
    return result


@app.post("/api/reflections")
async def reflections(payload: ReflectionRequestPayload, background_tasks: BackgroundTasks):
    should_log_doctext = should_log(payload.username)

    start_time = datetime.now()
    result = await nlp.reflection(userDoc=payload.prompt, paragraph=payload.paragraph)
    end_time = datetime.now()

    background_tasks.add_task(make_log, RequestLog(
        timestamp=end_time.timestamp(),
        username=payload.username,
        event="reflection_generated",
        request_type="Reflection",
        request=payload.sanitized() if not should_log_doctext else payload,
        result=result.result if should_log_doctext else f"{len(result.result)} characters REDACTED",
        delay=(end_time - start_time).total_seconds(),
    ))

    return result


@app.post("/api/chat")
async def chat(payload: ChatRequestPayload, background_tasks: BackgroundTasks):
    should_log_doctext = should_log(payload.username)

    start_time = datetime.now()
    response = await nlp.chat_stream(
        messages=payload.messages,
        temperature=0.7,
    )

    messages_for_log = json.dumps(payload.messages if should_log_doctext else [{
        "role": message.get("role", ""),
        "content": f"{len(message.get('content', ''))} characters REDACTED" if isinstance(message.get('content'), str) else "[REDACTED]"
    } for message in payload.messages])

    background_tasks.add_task(make_log, Log(
        timestamp=start_time.timestamp(),
        username=payload.username,
        event="chat_message",
        extra_data={
            "messages": messages_for_log
        }
    ))

    # Stream response
    async def generator():
        async for chunk in response:
            # chunk is a ChatCompletionChunk object
            yield chunk.model_dump_json()

    return EventSourceResponse(generator())


@app.post("/api/log")
async def log_from_client(payload: Dict[str, Any], background_tasks: BackgroundTasks):
    payload_copy = copy.deepcopy(payload)
    extra_data = {}
    if 'timestamp' in payload_copy:
        extra_data['client_timestamp'] = payload_copy.pop('timestamp')
    username = None
    if 'username' in payload_copy:
        try:
            username = validate_username(payload_copy.get('username', ''))
            # If validation succeeds...
            del payload_copy['username']
        except Exception:
            pass
    event = payload_copy.pop('event', 'unknown_event')
    extra_data.update(payload_copy)
    
    background_tasks.add_task(make_log, Log(
        timestamp=datetime.now().timestamp(),
        username=username or "unknown",
        event=event,
        extra_data=extra_data
    ))

    return {"message": "Feedback logged successfully."}


class PingResponse(BaseModel):
    timestamp: datetime

# Ping: return the server's current timestamp


@app.get("/api/ping")
async def ping() -> PingResponse:
    return PingResponse(timestamp=datetime.now())


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
