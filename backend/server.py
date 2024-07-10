import os
import json

from typing import List, Dict, Optional
from pathlib import Path
from datetime import datetime

import uvicorn
import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from sse_starlette.sse import EventSourceResponse

from pydantic import BaseModel, ConfigDict
from dotenv import load_dotenv

import nlp

# Load ENV vars
load_dotenv()

LOG_PATH = Path("./logs").absolute()

DEBUG = os.getenv("DEBUG") or False
PORT = int(os.getenv("PORT") or 8000)

# FIXME: Use auth0 instead
LOG_SECRET = os.getenv("LOG_SECRET", "").strip()
print(f"Log secret: {LOG_SECRET!r}")

# Declare Types


class GenerationRequestPayload(BaseModel):
    username: str
    gtype: str
    prompt: Optional[str] or Optional[List[Dict[str, str]]]


class Log(BaseModel):
    model_config = ConfigDict(extra='allow')
    timestamp: float
    ok: bool = True
    username: str
    interaction: str
    prompt: Optional[str] = None
    result: Optional[str] = None
    completion: Optional[str] = None


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
    '''
    To test this endpoint from curl:

    $ curl -X POST -H "Content-Type: application/json" -d '{"username": "test", "gtype": "Completion_Backend", "prompt": "This is a test prompt."}' http://localhost:8000/api/generation
    '''
    start_time = datetime.now()
    if payload.gtype == "Completion_Backend":
        result = await nlp.chat_completion(payload.prompt)
    elif payload.gtype == "Question_Backend":
        result = await nlp.question(payload.prompt)
    elif payload.gtype == "Keywords_Backend":
        result = await nlp.keywords(payload.prompt)
    elif payload.gtype == "Structure_Backend":
        result = await nlp.structure(payload.prompt)
    else:
        return {"error": "Invalid generation type."}
    end_time = datetime.now()

    make_log(
        Log(
            username=payload.username,
            interaction=payload.gtype,
            # prompt=payload.prompt,
            timestamp=end_time.timestamp(),
            delay=(end_time - start_time).total_seconds(),
            **result
        )
    )

    # FIXME: Return a structured object.
    return result['result']


@app.post("/api/log")
async def log_feedback(payload: Log):
    make_log(payload)

    return {"message": "Feedback logged successfully."}


# Show all server logs
@app.get("/api/logs")
async def logs(secret: str):
    async def log_generator():
        assert LOG_SECRET != "", "Logging secret not set."
        if secret != LOG_SECRET:
            yield json.dumps({"error": "Invalid secret."})
            return

        log_positions = {}

        while True:
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

    return EventSourceResponse(log_generator())


def get_participant_log_filename(username):
    assert "/" not in username, "Invalid username."
    return LOG_PATH / f"{username}.jsonl"


# Helper functions
def make_log(payload: Log):
    with open(get_participant_log_filename(payload.username), "a+") as f:
        f.write(json.dumps(payload.model_dump()) + "\n")


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
