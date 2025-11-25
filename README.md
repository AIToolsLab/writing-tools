# Setting up on local (Microsoft-Word web)

- Open a Microsoft word document on web
- Navigate to insert tab
- Click add-ins button, upload my add-in
- Drag add-in/manifest.xml into the upload bar
- Click upload

If you can't find the Add-ins tab, look instead on the File menu for "Get Add-ins" or something like that, then click Manage Add-ins.

# Running the add-in

- `cd frontend`
- `npm install`
- `npm run dev-server`

Run `npm run lint --fix` to auto-fix (almost) all lint errors.

# Running the backend server

After cloning this repo:

1. `uv sync` in the top-level folder; activate the `.venv` environment that this creates
2. `cd backend` (for all the following steps)
3. Run `uv run get_env.py` to create the `.env` file. (It'll prompt you for an OpenAI API key.)
4. Run the server: `uv run uvicorn server:app --host localhost --port 8000 --reload`

Run `./test_generation` script in the `backend` folder to make a test request. However, it runs against the prod server; change the URL to run against a local server (e.g., `http://localhost:8000/api/generation`).

Note: the custom LLM backend has moved to https://github.com/AIToolsLab/writing-prototypes.

# Running visual regression tests

Playwright visual regression tests capture screenshots and ensure UI consistency of the demo page. See [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md) for detailed instructions on running tests and updating baseline images.
