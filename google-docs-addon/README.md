# Google Docs Add-on

This folder contains the Google Apps Script code for the Thoughtful Google Docs add-on.

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

> ⚠️ The `.clasp.json` in this repo points at the **production** Apps Script project
> (the one the Marketplace listing serves). Only push to it when you mean to release.
> To develop on your own copy, create your own project as below and don't commit the
> resulting `.clasp.json`.

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

   The repo's `.clasp.json` points at production. Delete it first, then create your own:
   ```bash
   cd google-docs-addon
   rm .clasp.json
   clasp create --type docs --title "Thoughtful"
   ```
   Google may show another authorization screen — click **Allow**.
   This creates a new `.clasp.json` with your own `scriptId`.

   > **Alternative (if `clasp create` still gives errors):**
   > 1. Go to https://script.google.com and click **New project**
   > 2. Rename it to "Thoughtful"
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
   > - **Alternative:** Open https://script.google.com directly and find your "Thoughtful" project, or hover over it in the project list and click **Open Document**

   In the Apps Script editor: **Deploy → Test deployments → + Add test** → select a Google Doc → **Save**

7. **First time opening the sidebar in Google Docs:**
   Go to **Extensions → Thoughtful → Open Thoughtful**.
   Google will show an authorization screen — click **Review Permissions** → select your Google account → click **Allow**.
   This only happens once.

### Start the Dev Server (every time you test)

```bash
cd frontend
npm install       # only needed first time
npm run dev-server
```

Wait for Vite to print its local URL, then open your Google Doc and go to:
**Extensions → Thoughtful → Open Thoughtful**

No tunneling/ngrok is needed — the sidebar loads straight from localhost, and
the dev server proxies `/api` to the local backend.

### Building the Frontend for Google Docs

```bash
cd frontend
npm run build          # the Word/editor multi-page build
npm run build:google-docs
```

`build:google-docs` (`BUILD_TARGET=google-docs vite build`, see
`frontend/vite.config.ts`) emits two files into the shared `dist/`:

- `google-docs.bundle.js` — a single self-contained IIFE with every image and
  font inlined as base64
- `google-docs.css` — the extracted stylesheet

It builds into the same `dist/` with `emptyOutDir: false`, so run the plain
`npm run build` first. Both commands run in the repo-root `Dockerfile`, which
produces one image that serves the built frontend and the backend together.

### Choosing which build the sidebar loads

`sidebar.html` is the same file in every environment; it picks a source at
runtime from the **document title**, so no emails or flags are hard-coded:

- title contains `[dev]` → the sidebar shows a picker (localhost / staging /
  prod) and you choose which build to load
- otherwise → it loads the production bundle automatically

The chosen base URL is used for both `google-docs.bundle.js` and
`google-docs.css`, and the bundle then derives its **backend** origin from its
own `<script src>` (`frontend/src/api/index.ts`). Picking "staging" therefore
talks to the staging backend, not production — nothing environment-specific is
baked in at build time.

`sidebar.html` itself is what you `clasp push`; it is not part of the frontend
build output.

## Key Differences from Word Add-in

| Aspect | Word Add-in | Google Docs Add-on |
|--------|-------------|-------------------|
| Document API | Office.js (client-side) | DocumentApp (server-side via Apps Script) |
| UI Framework | HTML/JS in taskpane | HTML/JS in sidebar |
| Selection events | Native Office events | Polling (no native events) |

## OAuth Scopes

`appsscript.json` has no `oauthScopes` block, so Apps Script **infers** the scopes
from the code. Today that yields:

- `documents.currentonly` — read/edit only the current document (`DocumentApp`,
  limited by the `@OnlyCurrentDoc` annotation at the top of `Code.gs`)
- `script.container.ui` — show the add-on menu and sidebar (`DocumentApp.getUi()`)
- `userinfo.email` — identify the current user (`Session.getActiveUser()`)

The Marketplace SDK's App Configuration page lists scopes separately, and they must
match what the script actually requests. Because they're inferred, any change to
`Code.gs` that touches a new service (e.g. the Drive API for comments, #580) changes
the scopes silently — check the project's **Overview → Project OAuth Scopes** in the
Apps Script editor after such a change and update the SDK page to match.

Apps Script makes no outbound HTTP calls: the React sidebar fetches the backend
(and its own JS/CSS bundle) directly from the browser, which needs no Apps Script
scope.

`onHomepage`/`createHomepageCard` in `Code.gs` are leftovers from a Google Workspace
add-on (card UI) manifest. This is an **Editor** add-on (menu + HtmlService sidebar),
the manifest no longer references them, and they don't run.

## Deployment

See [../docs/google-publishing/README.md](../docs/google-publishing/README.md) for the
full Marketplace publishing checklist (consent screen, listing, review).

### Test Deployment

1. Push latest code: `clasp push`
2. In the Apps Script editor: **Deploy → Test deployments**, pick a test document
3. Open the doc: **Extensions → Thoughtful → Open Thoughtful**

### Releasing a new version

Editor add-ons are published by **script version number**, not deployment ID.

1. Ship the frontend first if the release depends on it (the sidebar loads the
   production bundle from the backend container, which deploys separately).
2. `clasp push` (from this folder; `.clasp.json` points at production)
3. `clasp version "short description"` → prints the new version number
   (UI equivalent: **Deploy → New deployment**, type *Add-on*, which creates a version)
4. Marketplace SDK → **App Configuration** → *Docs add-on* → set **Script version**
   to that number → **Save**

## Troubleshooting

### "Script function not found"
- Make sure you pushed the latest code: `clasp push`
- Check the function name matches exactly

### Selection polling feels slow
- The polling interval is set to 1 second in `googleDocsEditorAPI.ts`
- Can be adjusted but shorter intervals increase Apps Script quota usage

### Quota limits
- Script runtime: 6 minutes max per execution
