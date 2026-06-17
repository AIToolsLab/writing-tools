# Google Docs Add-on

This folder contains the Google Apps Script code for the Writing Tools Google Docs add-on.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Docs                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  HTML/JS Sidebar (React app from frontend/)         │    │
│  │                                                      │    │
│  │   google.script.run.getDocContext()  ──────────┐    │    │
│  │   google.script.run.selectPhrase(...)          │    │    │
│  │                                                 │    │    │
│  │   fetch() to Python backend  ───────────────┐  │    │    │
│  └──────────────────────────────────────────────│──│────┘    │
└─────────────────────────────────────────────────│──│─────────┘
                                                   │  │
       (document operations via google.script.run)│  │ (chat / revise / log
                                                   │  │  via direct HTTPS fetch)
                                                   │  ▼
                                                   │ ┌──────────────────────────┐
                                                   │ │  Python Backend (backend/)│
                                                   │ └──────────────────────────┘
                                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                  Apps Script (Code.gs)                       │
│                  (document operations only)                  │
│                                                              │
│  • getDocContext() → reads doc, returns to sidebar          │
│  • selectPhrase() → finds and selects text in doc           │
└─────────────────────────────────────────────────────────────┘
```

The React sidebar calls Apps Script (`google.script.run`) only for document
operations. All backend traffic (chat, revise, logging) goes from the React app
**directly** to the Python backend — Apps Script does not proxy it.

## Files

- `appsscript.json` - Add-on manifest with OAuth scopes and triggers
- `Code.gs` - Main Apps Script code (document operations only)
- `sidebar.html` - HTML entry point that loads the React app

## Development Setup

### Prerequisites

1. [Google clasp](https://github.com/google/clasp) - CLI tool for Apps Script
2. Node.js for building the frontend

### Initial Setup (First time on a new machine)

> ⚠️ The `.clasp.json` in this repo is linked to the original developer's Google account.
> You must create your **own** Apps Script project to overwrite it.

1. **Install clasp globally:**
   ```bash
   npx @google/clasp
   ```

2. **Enable Apps Script API for your Google account:**
   Go to https://script.google.com/home/usersettings and turn on **Google Apps Script API**.

3. **Login to clasp with your Google account:**
   ```bash
   npx @google/clasp login
   ```
   This opens a browser window — sign in with your Google account.
   Google will show an authorization screen asking for permissions — click **Allow**.

4. **Create your own Apps Script project (overwrites `.clasp.json`):**

   The repo includes a `.clasp.json` linked to another developer's account. You need to delete it first, then create your own:
   ```bash
   cd google-docs-addon
   rm .clasp.json
   clasp create --type docs --title "Writing Tools"
   ```
   Google may show another authorization screen — click **Allow**.
   This creates a new `.clasp.json` with your own `scriptId`.

   > **Alternative (if `clasp create` still gives errors):**
   > 1. Go to https://script.google.com and click **New project**
   > 2. Rename it to "Writing Tools"
   > 3. Copy the script ID from the URL: `https://script.google.com/home/projects/<SCRIPT_ID>/edit`
   > 4. Create `.clasp.json` manually:
   >    ```json
   >    {"scriptId": "YOUR_SCRIPT_ID", "rootDir": "."}
   >    ```

5. **Push the code to your Apps Script project:**
   ```bash
   clasp push --force
   ```

6. **Set up a Test Deployment:**
   ```bash
   clasp open
   ```
   > **If `clasp open` is not recognized:**
   > - Make sure clasp is installed globally: `npm install -g @google/clasp`
   > - On Windows, ensure the global npm bin folder (`%APPDATA%\npm`) is in your PATH
   > - **Alternative:** Open https://script.google.com directly and find your "Writing Tools" project, or hover over it in the project list and click **Open Document**

   In the Apps Script editor: **Deploy → Test deployments → + Add test** → select a Google Doc → **Save**

7. **First time opening the sidebar in Google Docs:**
   Go to **Extensions → Writing Tools → Open Writing Tools**.
   Google will show an authorization screen — click **Review Permissions** → select your Google account → click **Allow**.
   This only happens once.

### Start the Dev Server (every time you test)

```bash
cd frontend
npm install       # only needed first time
npm run dev-server:google-docs
```

Wait for `webpack compiled successfully`, then open your Google Doc and go to:
**Extensions → Writing Tools → Open Writing Tools**



### Building the Frontend for Google Docs (Production)

```bash
cd frontend
npm run build:google-docs
```

This generates `dist-gdocs/sidebar-bundled.html` with the full React app inlined.

### Development vs. production sidebar

There is no runtime dev/prod flag — the two modes are just two versions of
`sidebar.html`:

- **Development:** the `sidebar.html` checked into this repo loads the React bundle
  and CSS **directly from the local dev server** at `http://localhost:3001`
  (started by `npm run dev-server:google-docs`). No tunneling/ngrok is needed — the
  sidebar points straight at localhost.
- **Production:** `npm run build:google-docs` produces
  `dist-gdocs/sidebar-bundled.html` with all JS/CSS inlined; that file is what you
  `clasp push` for a real deployment.

## Key Differences from Word Add-in

| Aspect | Word Add-in | Google Docs Add-on |
|--------|-------------|-------------------|
| Document API | Office.js (client-side) | DocumentApp (server-side via Apps Script) |
| UI Framework | HTML/JS in taskpane | HTML/JS in sidebar |
| Selection events | Native Office events | Polling (no native events) |

## OAuth Scopes

The add-on requests these scopes (auto-detected from API usage; no explicit
`oauthScopes` block in `appsscript.json`):

- `documents.currentonly` - Access only the current document
- `script.container.ui` - Display sidebars and dialogs
- `userinfo.email` - Identify the current user

Apps Script no longer makes outbound HTTP calls (the backend is called directly by
the React app), so `script.external_request` is no longer requested.

## Deployment

### Test Deployment

1. Push latest code: `clasp push`
2. Create test deployment in Apps Script editor
3. Install for testing

### Production Deployment

1. Build the frontend: `npm run build:google-docs`
2. Push to Apps Script: `clasp push`
3. Create a new version: `clasp version "v1.0.0"`
4. Deploy: `clasp deploy --versionNumber <version>`
5. Submit for Google Workspace Marketplace review (if distributing publicly)

## Troubleshooting

### "Script function not found"
- Make sure you pushed the latest code: `clasp push`
- Check the function name matches exactly

### Selection polling feels slow
- The polling interval is set to 1 second in `googleDocsEditorAPI.ts`
- Can be adjusted but shorter intervals increase Apps Script quota usage

### Quota limits
- Script runtime: 6 minutes max per execution


### Scopes we probably need

| Name | Oauth Scope |
|---|---|
| See, edit, create, and delete all your Google Docs documents | https://www.googleapis.com/auth/documents |
| Display and run third-party web content in prompts and sidebars inside Google applications | https://www.googleapis.com/auth/script.container.ui |
| See your primary Google Account email address	| https://www.googleapis.com/auth/userinfo.email |
