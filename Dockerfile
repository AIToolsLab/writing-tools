# Single-container production image: the Hono backend serves both the built
# frontend (frontend/dist) and the /api/* routes. Build context is the repo
# ROOT (it needs both frontend/ and backend/).
#
# Local dev is unaffected — developers still run the Vite dev-server and
# `npm run dev` separately. This image is a deploy concern only.

# 1) Build the frontend -> /frontend/dist (Vite). Includes the Google Docs
#    sidebar bundle (dist/google-docs.bundle.js), same as the old frontend image.
FROM node:24-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build && npm run build:google-docs

# 2) Build the backend -> /app/backend/dist (tsc).
FROM node:24-slim AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# 3) Runtime: Node serving the compiled backend + the frontend as static files.
FROM node:24-slim AS run
WORKDIR /app/backend
ENV NODE_ENV=production
# STATIC_ROOT (backend/src/static.ts) and LOG_DIR default to ./public and
# ./logs; compose sets LOG_DIR to the mounted data volume.
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=backend /app/backend/dist ./dist
# Frontend build output becomes the static root (STATIC_ROOT=./public).
COPY --from=frontend /frontend/dist ./public
# The Apps Script sidebar loads the Google Docs bundle by absolute URL at
# /gdocs/google-docs.bundle.js (its PROD_BASE points there), so expose it at
# that path in addition to the dist root.
COPY --from=frontend /frontend/dist/google-docs.bundle.js ./public/gdocs/google-docs.bundle.js
EXPOSE 5000
CMD ["node", "dist/index.js"]
