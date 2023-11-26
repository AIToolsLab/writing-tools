import os
import json

import openai

from fastapi import APIRouter, Depends

from sse_starlette import EventSourceResponse

from dotenv import load_dotenv

from nlp.nlp import (
    gen_reflections_chat,
    ReflectionResponseInternal
)

from .schemas import (
    LogSchema,
    RequestSchema,
    ReflectionRequest,
    ReflectionResponseItem,
    ReflectionResponses,
    ChatRequest
)

from database.config import SessionLocal
from sqlalchemy.orm import Session

from database import crud

# Load ENV vars
load_dotenv()

openai.organization = os.getenv(
    'OPENAI_ORGANIZATION') or 'org-9bUDqwqHW2Peg4u47Psf9uUo'
openai.api_key = os.getenv('OPENAI_API_KEY')

router = APIRouter()


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()


async def get_reflections(request: ReflectionRequest, db: Session) -> ReflectionResponses:
    reflection = crud.get_request_by_prompt_and_text(
        db=db,
        prompt=request.prompt,
        text=request.text
    )

    if reflection:
        response = json.loads(reflection.response)

        # assume that the database stores only valid responses in the correct schema.
        reflections_internal = ReflectionResponseInternal(**response)
    else:
        # Else, make the request and cache the response
        reflections_internal = await gen_reflections_chat(
            text=request.text,
            prompt=request.prompt,
        )

        crud.create_request(
            db=db,
            request=RequestSchema(
                username=request.username,
                prompt=request.prompt,
                text=request.text,
                response=json.dumps(reflections_internal.dict()),
                success=True
            )
        )

    return ReflectionResponses(
        reflections=[
            ReflectionResponseItem(reflection=reflection)
            for reflection in reflections_internal.reflections
        ]
    )


@router.post('/api/reflections')
async def reflections(payload: ReflectionRequest, db: Session = Depends(get_db)):
    crud.create_log(
        db=db,
        log=LogSchema(
            username=payload.username,
            interaction='reflection',
            prompt=payload.prompt,
            ui_id=None
        )
    )

    return await get_reflections(payload, db)


@router.post('/api/chat')
async def chat(payload: ChatRequest, db: Session = Depends(get_db)):
    response = await openai.ChatCompletion.acreate(
        model='gpt-3.5-turbo',
        messages=payload.messages,
        temperature=0.7,
        max_tokens=1024,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        stream=True
    )

    crud.create_log(
        db=db,
        log=LogSchema(
            username=payload.username,
            interaction='chat',
            prompt=payload.messages[-1]['content'],
            ui_id=None
        )
    )

    # Stream response
    async def generator():
        async for chunk in response:
            if chunk['choices'][0]['finish_reason'] == 'stop':
                break

            yield chunk['choices'][0]['delta']['content']

    return EventSourceResponse(generator())


@router.post('/log')
async def log_feedback(payload: LogSchema, db: Session = Depends(get_db)):
    crud.create_log(
        db=db,
        log=payload
    )

    return {'message': 'Feedback logged successfully.'}

# Show all requests made to the server


@router.get('/requests')
async def logs(db: Session = Depends(get_db)):
    return crud.get_requests(db=db)

# Show all server logs


@router.get('/logs')
async def logs(db: Session = Depends(get_db)):
    return crud.get_logs(db=db)
