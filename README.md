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

Note: the custom LLM backend has moved to https://github.com/AIToolsLab/writing-prototypes.


# Contributing

We follow specific GitHub conventions to keep our project organized and maintain code quality.

**Quick Start:**
1. Create an issue for your task
2. Create a branch: `<type>/<description>` (e.g., `feat/add-user-login`)
3. Make commits: `<type>: <description>` (e.g., `feat: add login form`)
4. Open a PR and link to your issue
5. Get at least one approval before merging

For detailed conventions on branch naming, commit messages, PR process, and issue management, see [CONTRIBUTING.md](CONTRIBUTING.md).