#!/usr/bin/env bash
set -euo pipefail

root="$(dirname "$(dirname "$0")")"
echo "Running post-create for writing-tools in $root"

# Install frontend deps using npm
if [ -d "$root/frontend" ]; then
  echo "Installing frontend dependencies..."
  pushd "$root/frontend"
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund || npm install
  else
    npm install || true
  fi
  popd >/dev/null
else
  echo "No frontend directory found; skipping frontend install"
fi

# backend setup using 'uv'
if [ -d "$root/backend" ]; then
  echo "Setting up backend..."
  pushd "$root/backend" >/dev/null
  uv sync --locked || uv sync
  popd >/dev/null
else
  echo "No backend directory found; skipping backend setup"
fi

echo "Post-create finished. Recommended next steps:"
echo " - Open the Codespace and run the frontend dev server: (cd frontend && npm run dev-server)"
echo " - Start backend: (cd backend && uv run uvicorn server:app --host localhost --port 8000 --reload)"
