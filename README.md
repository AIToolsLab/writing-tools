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
-   `python server.py`

# `.env`

The `.env` file should have the following in it:

```
OPENAI_API_KEY=YOUR_KEY
AUTH0_DOMAIN = your.domain.auth0.com
AUTH0_API_AUDIENCE = https://your.api.audience
AUTH0_ISSUER = https://your.domain.auth0.com/
AUTH0_ALGORITHMS = RS256
```

Our auth0 config info can be found by asking Connor.
