FROM python:3.11

WORKDIR /app

# Install uv
RUN pip install uv

# Copy pyproject.toml
COPY pyproject.toml .

# Install dependencies using uv with --system flag
RUN uv pip install --system .

# Install en_core_web_sm model
RUN uv pip install --system https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# Copy backend files
COPY backend .

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5000"]
