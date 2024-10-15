# Setting up on local (Microsoft-Word web)

-   Open a Microsoft word document on web
-   Navigate to insert tab
-   Click add-ins button, upload my add-in
-   Drag add-in/manifest.xml into the upload bar
-   Click upload

If you can't find the Add-ins tab, look instead on the File menu for "Get Add-ins" or something like that, then click Manage Add-ins.

# Running the add-in

-   `cd add-in`
-   `yarn`
-   `yarn run dev-server`

Run `yarn lint --fix` to auto-fix (almost) all lint errors.

# Running the backend server

After cloning this repo:

1. `uv sync` in the top-level folder; activate the `.venv` environment that this creates
2. `cd backend` (for all the following steps)
3. Run `az login` to authenticate with Azure. (You may need to install the Azure CLI first.)
4. `uv run python get_env.py` to create the `.env` file.
5. Run the server.
    - Simple way: `uv run python server.py`
    - More robust way: `uv run uvicorn server:app --host localhost --port 8000 --reload`
    - For production: `uv run gunicorn` (see `gunicorn_conf.py` for settings)
        - `./update` to reload the server when you make changes (sends a `HUP` signal to the server)

Run `./test_generation` in the `backend` folder to make a test request. However, it runs against the prod server; change the URL to run against a local server.
