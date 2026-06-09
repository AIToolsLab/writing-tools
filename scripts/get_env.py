#!/usr/bin/env python3

"""Interactive helper to create backend/.env for local development.

Writes OPENAI_API_KEY, a freshly generated LOG_SECRET, and POSTHOG_PROJECT_TOKEN
to backend/.env, which the Hono backend loads via process.loadEnvFile() in dev.
(In Docker these are injected by docker-compose instead.)
"""

import random
import string
from pathlib import Path

repo_root = Path(__file__).parent.parent
env_file = repo_root / "backend" / ".env"

if env_file.exists():
    print(".env file already exists. Exiting...")
    exit(0)

print("Get an OpenAI API Key from https://platform.openai.com/account/api-keys")
print ("(Check with project is selected in the top-left corner)")
openai_api_key = input("Enter your OpenAI API Key: ").strip()

if not openai_api_key.startswith("sk-"):
    print("That key doesn't look like a valid OpenAI API key. Exiting...")
    exit(1)

log_secret = '-'.join(''.join(random.choices(string.ascii_lowercase + string.digits, k=6)) for _ in range(6))

posthog_project_token = input("PostHog project token (from https://us.posthog.com/project/247756/settings/project-details): ").strip()

with open(env_file, "w") as f:
    f.write(f'OPENAI_API_KEY="{openai_api_key}"\n')
    f.write(f'LOG_SECRET="{log_secret}"\n')
    f.write(f'POSTHOG_PROJECT_TOKEN="{posthog_project_token}"\n')

print(f".env file created at {env_file}")
