FROM python:3.11

WORKDIR /app

# Install uv
RUN pip install uv

# Copy pyproject.toml
COPY pyproject.toml .

# Install dependencies using uv with --system flag
RUN uv sync --frozen


# Copy backend files
COPY backend .

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5000"]
