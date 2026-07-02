#!/usr/bin/env bash
# Fail if a Docker build context would ship secrets or junk.
#
# Rather than re-implement .dockerignore matching, this materializes exactly
# what Docker would send as the context (COPY . into a throwaway image, which
# honors the context's .dockerignore) and scans the result. That means the
# check can't drift from the real build: if a file reaches the image, it reaches
# this audit too.
#
# Usage: audit-build-context.sh <context-dir>
set -euo pipefail

CONTEXT="${1:?usage: audit-build-context.sh <context-dir>}"
TAG="ctx-audit-$$"

cleanup() { docker rmi -f "$TAG" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Build a minimal image whose only content is the build context.
docker build -q -t "$TAG" -f - "$CONTEXT" <<'DOCKERFILE' >/dev/null
FROM busybox
COPY . /ctx
DOCKERFILE

# Files that must never be in a build context. .env.example and friends are
# intentional templates, so they're the only .env* allowed through.
leaks="$(docker run --rm "$TAG" sh -c '
  cd /ctx && find . \( \
      \( -name ".env" -o -name ".env.*" -o -name ".env-*" \) \
        ! -name ".env.example" ! -name ".env.sample" ! -name ".env.template" \
    -o -name "__pycache__" \
    -o -name ".mypy_cache" \
    -o -name ".ruff_cache" \
    -o -name ".pytest_cache" \
    -o -name "node_modules" \
  \) -print | sort
')"

if [ -n "$leaks" ]; then
  echo "::error::Forbidden files present in the Docker build context ($CONTEXT):"
  echo "$leaks" | sed 's/^/  /'
  echo "Add matching patterns to the relevant .dockerignore."
  exit 1
fi

echo "Build context ($CONTEXT) is clean."
