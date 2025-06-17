import asyncio
import json
import logging
import os
import signal
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Annotated, Dict, List, Optional

import nlp
import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from sse_starlette.sse import EventSourceResponse

# Load ENV vars
load_dotenv()

LOG_PATH = Path("./logs").absolute()

DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or 8000)

# The log secret is stored in .env file for local development.
LOG_SECRET = os.getenv("LOG_SECRET", "").strip()
print(f"Log secret: {LOG_SECRET!r}")


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
    interaction: str


class GenerationLog(Log):
    prompt: str
    result: str
    completion: Optional[str] = None
    delay: float


class ReflectionLog(Log):
    paragraph: str


shutting_down = False

@asynccontextmanager
async def app_lifespan(app: FastAPI):
    global shutting_down
    print("Starting up server...")
    yield
    # shutdown
    print("Shutting down server...")
    shutting_down = True

# Also shutdown on Ctrl+C (SIGINT) or SIGTERM
def signal_handler(signal_number, frame):
    global shutting_down
    print(f"Received signal {signal_number}. Shutting down server...")
    shutting_down = True

def combined_signal_handler(signal_number, frame):
    signal_handler(signal_number, frame)
    if signal_number == signal.SIGINT and callable(old_sigint_handler):
        old_sigint_handler(signal_number, frame)
    if signal_number == signal.SIGTERM and callable(old_sigterm_handler):
        old_sigterm_handler(signal_number, frame)

old_sigint_handler = signal.signal(signal.SIGINT, combined_signal_handler)
old_sigterm_handler = signal.signal(signal.SIGTERM, combined_signal_handler)

# Initialize Server
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
@app.post("/api/generation")
async def generation(payload: GenerationRequestPayload, background_tasks: BackgroundTasks) -> nlp.GenerationResult:
    '''
    To test this endpoint from curl:

    $ curl -X POST -H "Content-Type: application/json" -d '{"username": "test", "gtype": "Completion_Backend", "prompt": "This is a test prompt."}' http://localhost:8000/api/generation
    '''
    should_log_doctext = should_log(payload.username)

    start_time = datetime.now()
    if payload.gtype == "Completion_Backend":
        result = await nlp.chat_completion(payload.prompt)
    elif payload.gtype == "Question_Backend":
        result = await nlp.question(payload.prompt)
    elif payload.gtype == "Keywords_Backend":
        result = await nlp.keywords(payload.prompt)
    elif payload.gtype == "Structure_Backend":
        result = await nlp.structure(payload.prompt)
    elif payload.gtype == "RMove_Backend":
        result = await nlp.rmove(payload.prompt)
    else:
        raise ValueError(f"Invalid generation type: {payload.gtype}")
    end_time = datetime.now()

    log_entry = GenerationLog(
        timestamp=end_time.timestamp(),
        username=payload.username,
        interaction=payload.gtype,
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

    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

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

    log_entry = ReflectionLog(
        username=payload.username,
        interaction="reflection",
        prompt=payload.prompt if should_log_doctext else "",
        paragraph=payload.paragraph if should_log_doctext else "",
        timestamp=end_time.timestamp(),
        delay=(end_time - start_time).total_seconds(),
        result=result.result if should_log_doctext else "",
    )

    background_tasks.add_task(make_log, log_entry)

    return result


@app.post("/api/chat")
async def chat(payload: ChatRequestPayload):
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
    # interaction="chat",
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


# Show all server logs
@app.get("/api/logs")
async def logs(secret: str, request: Request):
    async def log_generator():
        assert LOG_SECRET != "", "Logging secret not set."
        if secret != LOG_SECRET:
            yield json.dumps({"error": "Invalid secret."})
            return

        log_positions = {}

        try:
            while True:
                print("Tick")
                if shutting_down or await request.is_disconnected():
                    print("Shutting down or client disconnected.")
                    break
                updates = []
                log_files = {
                    participant.stem: participant for participant in LOG_PATH.glob("*.jsonl")}

                for username, log_file in log_files.items():
                    with open(log_file, "r") as file:
                        file.seek(log_positions.get(username, 0))
                        new_lines = file.readlines()

                        if new_lines:
                            updates.append({
                                "username": username,
                                "logs": [json.loads(line) for line in new_lines],
                            })
                            log_positions[username] = file.tell()

                if updates:
                    yield json.dumps(updates)

                await asyncio.sleep(1)  # Adjust the sleep time as needed
        except asyncio.CancelledError:
            print("Connection closed by client.")

    return EventSourceResponse(log_generator(), send_timeout=10.0)


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
