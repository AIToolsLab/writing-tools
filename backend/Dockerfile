FROM python:3.11

WORKDIR /app

# Install uv
RUN pip install uv

# Copy pyproject.toml and uv.lock from the parent directory
COPY ../pyproject.toml ../uv.lock ./

# Install dependencies using uv with --frozen flag
RUN uv sync --frozen

# activate the .venv environment
RUN uv venv .venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy backend files
COPY . .

WORKDIR /app/backend

# run the server
# TODO: where do the log entries end up? Perhaps stop redirecting logs to files?
CMD ["uv", "run", "gunicorn"]
