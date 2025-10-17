FROM node:24-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install curl, git, python3 and build deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates git build-essential python3 python3-venv python3-pip sudo \
    && rm -rf /var/lib/apt/lists/*

# Copy uv binaries from the Astral 'uv' image so the uv CLI is available
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Create a non-root 'vscode' user to match Codespaces expectations
ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=1000
RUN groupadd --gid ${USER_GID} ${USERNAME} || true \
    && useradd -s /bin/bash --uid ${USER_UID} --gid ${USER_GID} -m ${USERNAME} || true \
    && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} \
    && chmod 0440 /etc/sudoers.d/${USERNAME}

USER ${USERNAME}

WORKDIR /workspace

CMD ["sleep", "infinity"]
