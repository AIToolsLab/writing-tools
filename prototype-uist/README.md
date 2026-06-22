# UIST 2026 — Reflective Writing Prototype

A standalone prototype of the project's core idea: **AI must be genuinely useful,
but never replace the user as the expressive subject.** The AI organizes and
reflects; it never writes the essay for you.

## Pipeline

1. **Voice / text input** (left panel) — talk the way you think; scattered
   thought is raw material.
2. **AI organization** — input distilled into bullet points.
3. **Mindmap** (right panel) — ideas as editable nodes, connections as edges,
   expansion chips as *branching directions* (not generated content).
4. **Pros/cons table** — tradeoffs of the selected idea.
5. **Signature interaction** — when you edit any node, the AI reflects the edit
   back: it asks *why* and surfaces what the edit gains and loses. It never
   silently accepts an edit or auto-rewrites.

## Run

This prototype calls the existing `backend/` OpenAI proxy.

```sh
# 1. Start the backend (from repo root /backend), needs OPENAI_API_KEY in its .env
cd ../backend && npm run dev        # serves on http://localhost:8000

# 2. Start this prototype
cd ../prototype-uist
npm install
npm run dev                         # opens http://localhost:5180
```

Override the backend location with the `VITE_BACKEND_URL` env var (defaults to
`http://localhost:8000/api`). Voice input uses the Web Speech API — best in
Chrome/Edge.

## Stack

Vite + React + TypeScript + [@xyflow/react](https://reactflow.dev) for the mindmap.
