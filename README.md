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

# Running the server

-   `cd backend`
-   `pip install -r requirements.txt`
-   Create a `.env` file and add `OPENAI_API_KEY=YOUR_KEY`(If you don't have an API key, visit [https://platform.openai.com/account/api-keys])
-   `fastapi dev --port 3000 server.py`

In production, use `fastapi run server.py` instead of `fastapi dev server.py`.
