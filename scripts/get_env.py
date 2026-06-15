#!/usr/bin/env python3

"""Interactive helper to ensure backend/.env has the keys local dev needs.

Ensures OPENAI_API_KEY, LOG_SECRET, POSTHOG_PROJECT_TOKEN, and the Better Auth
keys exist in backend/.env, which the Hono backend loads via process.loadEnvFile()
in dev. (In Docker these are injected by docker-compose instead.)

This is non-destructive: existing keys are left untouched, and only missing keys
are appended. Run it again any time new keys are added.

Auth is written disabled by default (BETTER_AUTH_ENABLED=false). BETTER_AUTH_SECRET
is generated automatically — it's only used for local dev sessions (and prod doesn't
use .env), so there's nothing sensitive to protect here.
"""

import secrets
import string
from pathlib import Path

repo_root = Path(__file__).parent.parent
env_file = repo_root / "backend" / ".env"


def existing_keys(path: Path) -> set[str]:
    """Return the set of env var names already defined in the file."""
    keys = set()
    if not path.exists():
        return keys
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        keys.add(line.split("=", 1)[0].strip())
    return keys


def gen_log_secret() -> str:
    return "-".join(
        "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(6))
        for _ in range(6)
    )


def prompt_openai_key() -> str:
    print("Get an OpenAI API Key from https://platform.openai.com/account/api-keys")
    print("(Check which project is selected in the top-left corner)")
    key = input("Enter your OpenAI API Key: ").strip()
    if not key.startswith("sk-"):
        print("That key doesn't look like a valid OpenAI API key. Exiting...")
        exit(1)
    return key


def prompt_posthog_token() -> str:
    return input(
        "PostHog project token (from "
        "https://us.posthog.com/project/247756/settings/project-details): "
    ).strip()


present = existing_keys(env_file)

# (key, value-or-callable, optional comment lines to write before it).
# Callables are only invoked when the key is actually missing, so we only
# prompt for what we still need.
entries = [
    ("OPENAI_API_KEY", prompt_openai_key, None),
    ("LOG_SECRET", gen_log_secret, None),
    ("POSTHOG_PROJECT_TOKEN", prompt_posthog_token, None),
    ("BETTER_AUTH_ENABLED", "false", [
        "Auth — opt-in. Set BETTER_AUTH_ENABLED=true and fill the Google",
        "credentials to enable the Better Auth flow.",
    ]),
    ("BETTER_AUTH_SECRET", gen_log_secret, None),
    ("BETTER_AUTH_URL", "http://localhost:8000", None),
    ("BETTER_AUTH_TRUSTED_ORIGINS", "http://localhost:8000,https://localhost:3000", None),
    ("GOOGLE_CLIENT_ID", "", None),
    ("GOOGLE_CLIENT_SECRET", "", None),
    ("BETTER_AUTH_DEVICE_CLIENT_IDS", "writing-tools-device-poc", [
        "Device flow client IDs (comma-separated). Use writing-tools-device-poc for local dev.",
        "Set to your real client ID(s) externally before enabling in production.",
    ]),
]

missing = [e for e in entries if e[0] not in present]

if not missing:
    print(f".env already has all expected keys ({env_file}). Nothing to do.")
    exit(0)

lines = []
for key, value, comments in missing:
    if comments:
        lines.append("")
        lines.extend(f"# {c}" for c in comments)
    resolved = value() if callable(value) else value
    # Quote prompted/generated string values; leave plain literals (booleans,
    # URLs, empty defaults) unquoted to match the original file's style.
    if key in ("OPENAI_API_KEY", "LOG_SECRET", "POSTHOG_PROJECT_TOKEN"):
        lines.append(f'{key}="{resolved}"')
    else:
        lines.append(f"{key}={resolved}")

# Append, preserving anything already in the file.
needs_leading_newline = env_file.exists() and env_file.read_text() and not env_file.read_text().endswith("\n")
with open(env_file, "a") as f:
    if needs_leading_newline:
        f.write("\n")
    f.write("\n".join(lines) + "\n")

print(f"Added {len(missing)} missing key(s) to {env_file}:")
for key, *_ in missing:
    print(f"  - {key}")
