import os
import json

import dotenv

from pydantic import BaseModel

import openai

import nest_asyncio
import uvicorn

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

nest_asyncio.apply()

dotenv.load_dotenv()

openai.organization = 'org-9bUDqwqHW2Peg4u47Psf9uUo'
openai.api_key = os.getenv('OPENAI_API_KEY')


class Payload(BaseModel):
    essay: str

app = FastAPI()

origins = [
    'http://localhost',
    'http://localhost:8080',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.post('/summarize')
async def questions(payload: Payload):
    # ! Look at prompt and guidance/jsonformer
    prompt = '''
        ```json
            {
                "summary": "{{ gen 'summary' }}"
            }
        ```

        Write a summary for the following piece of writing using the JSON format above.
    ''' + payload.essay + '\n\n ```json \n'

    response = openai.Completion.create(
        model='text-davinci-003',
        prompt=prompt,
        temperature=0.7,
        max_tokens=256,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0,
        echo=True
    )

    return response['choices'][0]['text'].split('```json')[2]

uvicorn.run(app, port=8000)
