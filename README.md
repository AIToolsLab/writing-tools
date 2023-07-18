# Setting up on local (Microsoft-Word web)

-   Open a Microsoft word document on web
-   Navigate to insert tab
-   Click add-ins button, upload my add-in
-   Drag add-in/manifest.xml into the upload bar
-   Click upload

# Running the add-in

-   `cd add-in`
-   `npm i`
-   `npm run dev-server`

# Running the server

-   `cd backend`
-   `pip install -r requirements.txt`
-   Create a `.env` file and add `OPENAI_API_KEY=YOUR_KEY`(If you don't have an API key, visit [https://platform.openai.com/account/api-keys])
-   `python server.py`
