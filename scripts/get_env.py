#!/usr/bin/env python3

"""Interactive helper to create backend/.env for local development.

Writes OPENAI_API_KEY, a freshly generated LOG_SECRET, POSTHOG_PROJECT_TOKEN, and
the Better Auth keys to backend/.env, which the Hono backend loads via
process.loadEnvFile() in dev. (In Docker these are injected by docker-compose instead.)

Auth is written disabled by default (BETTER_AUTH_ENABLED=false). A BETTER_AUTH_SECRET
is pre-generated so enabling auth later only requires setting the flag and the Google
credentials.
"""

import base64
import os
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

# Pre-generate a strong Better Auth secret (>=32 bytes). Auth stays disabled
# until BETTER_AUTH_ENABLED is set to true and Google credentials are filled in.
better_auth_secret = base64.b64encode(os.urandom(32)).decode("ascii")

with open(env_file, "w") as f:
    f.write(f'OPENAI_API_KEY="{openai_api_key}"\n')
    f.write(f'LOG_SECRET="{log_secret}"\n')
    f.write(f'POSTHOG_PROJECT_TOKEN="{posthog_project_token}"\n')
    f.write("\n")
    f.write("# Auth — opt-in. Set BETTER_AUTH_ENABLED=true and fill the Google\n")
    f.write("# credentials to enable the Better Auth flow.\n")
    f.write('BETTER_AUTH_ENABLED=false\n')
    f.write(f'BETTER_AUTH_SECRET="{better_auth_secret}"\n')
    f.write('BETTER_AUTH_URL=http://localhost:8000\n')
    f.write('BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:8000,https://localhost:3000\n')
    f.write('GOOGLE_CLIENT_ID=\n')
    f.write('GOOGLE_CLIENT_SECRET=\n')

print(f".env file created at {env_file}")
