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
│  │   google.script.run.analyzeText(...)           │    │    │
│  └────────────────────────────────────────────────│────┘    │
└───────────────────────────────────────────────────│─────────┘
                                                    │
                                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  Apps Script (Code.gs)                       │
│                                                              │
│  • getDocContext() → reads doc, returns to sidebar          │
│  • selectPhrase() → finds and selects text in doc           │
│  • proxyToBackend() → UrlFetchApp to Python backend         │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS (UrlFetchApp)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Python Backend (backend/)                       │
│                      (unchanged)                             │
└─────────────────────────────────────────────────────────────┘
```

## Files

- `appsscript.json` - Add-on manifest with OAuth scopes and triggers
- `Code.gs` - Main Apps Script code (document operations + backend proxy)
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
   npm install -g @google/clasp
   ```

2. **Login to clasp with your Google account:**
   ```bash
   clasp login
   ```
   This opens a browser window — sign in with your Google account.

3. **Create your own Apps Script project (overwrites `.clasp.json`):**
   ```bash
   cd google-docs-addon
   clasp create --type docs --title "Writing Tools"
   ```
   This overwrites `.clasp.json` with your own `scriptId`.

4. **Push the code to your Apps Script project:**
   ```bash
   clasp push --force
   ```

5. **Set up a Test Deployment:**
   ```bash
   clasp open
   ```
   In the browser: **Deploy → Test deployments → + Add test** → select a Google Doc → **Save**

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


For now, development uses the standalone test functions in `sidebar.html`.

## Key Differences from Word Add-in

| Aspect | Word Add-in | Google Docs Add-on |
|--------|-------------|-------------------|
| Document API | Office.js (client-side) | DocumentApp (server-side via Apps Script) |
| UI Framework | HTML/JS in taskpane | HTML/JS in sidebar |
| API calls | Direct from browser | Proxied through Apps Script |
| Selection events | Native Office events | Polling (no native events) |
| Auth | Auth0 with popup | Google identity or Auth0 popup |

## OAuth Scopes

The add-on requests these scopes (in `appsscript.json`):

- `documents.currentonly` - Access only the current document
- `script.container.ui` - Display sidebars and dialogs
- `script.external_request` - Make HTTP requests to the backend

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

### "Access denied" or CORS errors
- Backend must allow requests from `https://script.google.com`
- Check the backend URL is correct in Script Properties

### Selection polling feels slow
- The polling interval is set to 1 second in `googleDocsEditorAPI.ts`
- Can be adjusted but shorter intervals increase Apps Script quota usage

### Quota limits
- UrlFetchApp: 20,000 calls/day (consumer), 100,000/day (Workspace)
- Script runtime: 6 minutes max per execution
- Consider caching responses where appropriate
