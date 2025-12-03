TypeScript/React Microsoft Office Add-in for Word + standalone editor

**Central concept**: LLM helps thinking and reflection instead of replacing writing.

`npm` package manager.


### Frontend (Office Add-in)
- **Office.js APIs** - Microsoft Word integration
- **State Management**: Jotai atoms (see `frontend/src/contexts/`)
- **Path Alias**: `@/*` maps to `./src/*` (webpack config)
- **Entry Points**:
  - `src/taskpane.html` - Word task pane
  - `src/editor/editor.html` - Standalone demo editor and user study
- **Manifest**: `frontend/manifest.xml` for Office Add-in configuration

## User Study Mode

The application includes a built-in user study system. See [STUDY.md](STUDY.md) for complete details on:
- Study flow and URL parameters
- Condition codes and configuration
- State management and logging
- Study-specific components

