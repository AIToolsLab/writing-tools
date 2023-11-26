import os
import uvicorn

from dotenv import load_dotenv

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from server.routes import router

from database import models
from database.config import engine

models.Base.metadata.create_all(bind=engine)

load_dotenv()

DEBUG = os.getenv('DEBUG') or False
PORT = os.getenv('PORT') or 8000

app = FastAPI()

app.include_router(router)

origins = [
    '*',
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

static_path = Path('../../add-in/dist')
if static_path.exists():
    @app.get('/')
    def index():
        return FileResponse(static_path / 'index.html')

    # Get access to files on the server. Only for a production build.
    app.mount('', StaticFiles(directory=static_path), name='static')
else:
    print('Not mounting static files because the directory does not exist.')
    print('To build the frontend, run `yarn run build` in the add-in directory.')


if __name__ == '__main__':
    uvicorn.run(app, host='localhost', port=PORT)
