# Setting up on local (Microsoft-Word web)

- Open a Microsoft word document on web
- Navigate to insert tab
- Click add-ins button, upload my add-in
- Drag add-in/manifest.xml into the upload bar
- Click upload

If you can't find the Add-ins tab, look instead on the File menu for "Get Add-ins" or something like that, then click Manage Add-ins.

# Running the add-in

- `cd frontend`
- `yarn`
- `yarn run dev-server`

Run `yarn lint --fix` to auto-fix (almost) all lint errors.

# Running the backend server

After cloning this repo:

1. `uv sync` in the top-level folder; activate the `.venv` environment that this creates
2. `cd backend` (for all the following steps)
3. Create a `.env` file in `backend` with `OPENAI_API_KEY=your-api-key`
4. Run the server: `uv run uvicorn server:app --host localhost --port 8000 --reload`

Run `./test_generation` in the `backend` folder to make a test request. However, it runs against the prod server; change the URL to run against a local server.

# Running the custom LLM backend

- `cd backend`
- `uv run --group gpu custom_llm.py --gpu`
