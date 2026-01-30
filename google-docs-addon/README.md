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
2. A Google Cloud project with Apps Script API enabled
3. Node.js for building the frontend

### Initial Setup

1. **Install clasp globally:**
   ```bash
   npm install -g @google/clasp
   ```

2. **Login to clasp:**
   ```bash
   clasp login
   ```

3. **Create a new Apps Script project:**
   ```bash
   cd google-docs-addon
   clasp create --type docs --title "Writing Tools"
   ```
   This creates a `.clasp.json` file with your script ID.

4. **Push the code to Google:**
   ```bash
   clasp push
   ```

5. **Open the script in the browser:**
   ```bash
   clasp open
   ```

### Configure Backend URL

In the Apps Script editor or via clasp:

1. Go to Project Settings > Script Properties
2. Add a property:
   - Key: `BACKEND_URL`
   - Value: Your backend URL (e.g., `https://your-backend.com` or `http://localhost:5001` for development)

### Testing the Add-on

1. In the Apps Script editor, click "Deploy" > "Test deployments"
2. Click "Install" next to "Test Add-on"
3. Open a Google Doc
4. Go to Extensions > Writing Tools > Open Writing Tools

### Building the Frontend for Google Docs

The sidebar needs the React app bundled and inlined. Add this build script to `frontend/package.json`:

```json
{
  "scripts": {
    "build:google-docs": "webpack --config webpack.google-docs.config.js"
  }
}
```

Then create `webpack.google-docs.config.js` to:
1. Bundle all React code into a single JS file
2. Inline it into `sidebar.html`

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
