FROM python:3.11

WORKDIR /app

# Install uv from the distroless image https://docs.astral.sh/uv/guides/integration/docker/#available-images
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy pyproject.toml and uv.lock from the parent directory
COPY ../pyproject.toml ../uv.lock ./

# Install dependencies
RUN uv sync --locked

# Copy backend files
COPY backend ./backend

WORKDIR /app/backend

# Expose the port the app runs on
EXPOSE 5000

# run the server
CMD ["uv", "run", "gunicorn"]
