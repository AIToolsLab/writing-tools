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
3. Run `uv run get_env.py` to create the `.env` file. (It'll prompt you for an OpenAI API key.)
4. Run the server: `uv run uvicorn server:app --host localhost --port 8000 --reload`

Run `./test_generation` script in the `backend` folder to make a test request. However, it runs against the prod server; change the URL to run against a local server (e.g., `http://localhost:8000/api/generation`).

# Running the custom LLM backend

- `cd backend`
- `uv run --group gpu custom_llm.py --gpu`

You may need to request access to a model on HuggingFace (e.g., https://huggingface.co/google/gemma-2-9b-it) and [login to huggingface-cli](https://huggingface.co/docs/huggingface_hub/main/en/guides/cli#hf-auth-login).
