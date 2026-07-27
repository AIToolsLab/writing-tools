#!/usr/bin/env python3

"""Interactive helper to ensure backend/.env has the keys local dev needs.

Ensures OPENAI_API_KEY, LOG_SECRET, POSTHOG_PROJECT_TOKEN, and the Better Auth
keys exist in backend/.env, which the Hono backend loads via process.loadEnvFile()
in dev. (In Docker these are injected by docker-compose instead.)

This is non-destructive: missing keys are appended, and required local device
client IDs are merged into the existing allowlist without removing custom IDs.
Run it again any time new keys or local clients are added.

Auth is written disabled by default (BETTER_AUTH_ENABLED=false). BETTER_AUTH_SECRET
is generated automatically — it's only used for local dev sessions (and prod doesn't
use .env), so there's nothing sensitive to protect here.
"""

import secrets
import string
import re
from pathlib import Path

repo_root = Path(__file__).parent.parent
env_file = repo_root / "backend" / ".env"
required_device_clients = [
    "writing-tools-device-poc",
    "writing-tools-editor-dev",
    "mindmap",
]


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
    ("BETTER_AUTH_DEVICE_CLIENT_IDS", ",".join(required_device_clients), [
        "Device flow/tool client IDs (comma-separated).",
        "Set to your real client ID(s) externally before enabling in production.",
    ]),
]

def merge_csv_assignment(
    source: str, key: str, required: list[str]
) -> tuple[str, list[str]]:
    """Merge a dotenv CSV assignment without disturbing its presentation."""
    pattern = re.compile(
        rf"^(\s*{re.escape(key)}\s*=\s*)(.*?)(\r?\n|$)", re.MULTILINE
    )
    match = pattern.search(source)
    if not match:
        return source, []
    raw = match.group(2)
    leading = raw[: len(raw) - len(raw.lstrip())]
    value_and_suffix = raw[len(leading) :]
    quote = value_and_suffix[:1] if value_and_suffix[:1] in ("'", '"') else ""
    suffix = ""
    if quote:
        close = value_and_suffix.find(quote, 1)
        if close == -1:
            return source, []
        value = value_and_suffix[1:close]
        suffix = value_and_suffix[close + 1 :]
    else:
        comment = re.search(r"(\s+#.*)$", value_and_suffix)
        if comment:
            value = value_and_suffix[: comment.start()].rstrip()
            suffix = value_and_suffix[comment.start() :]
        else:
            value = value_and_suffix.rstrip()
            suffix = value_and_suffix[len(value) :]
    values = [item.strip() for item in value.split(",") if item.strip()]
    added: list[str] = []
    for required_value in required:
        if required_value not in values:
            values.append(required_value)
            added.append(required_value)
    if not added:
        return source, []
    replacement = (
        match.group(1)
        + leading
        + quote
        + ",".join(values)
        + quote
        + suffix
        + match.group(3)
    )
    return source[: match.start()] + replacement + source[match.end() :], added


def read_preserving_newlines(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_preserving_newlines(path: Path, source: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(source)


def main() -> None:
    present = existing_keys(env_file)
    missing = [entry for entry in entries if entry[0] not in present]
    lines = []
    for key, value, comments in missing:
        if comments:
            lines.append("")
            lines.extend(f"# {comment}" for comment in comments)
        resolved = value() if callable(value) else value
        if key in ("OPENAI_API_KEY", "LOG_SECRET", "POSTHOG_PROJECT_TOKEN"):
            lines.append(f'{key}="{resolved}"')
        else:
            lines.append(f"{key}={resolved}")

    if lines:
        current = read_preserving_newlines(env_file) if env_file.exists() else ""
        newline = "\r\n" if "\r\n" in current else "\n"
        if current and not current.endswith(("\n", "\r")):
            current += newline
        current += newline.join(lines) + newline
        write_preserving_newlines(env_file, current)

    source = read_preserving_newlines(env_file)
    merged, added_clients = merge_csv_assignment(
        source, "BETTER_AUTH_DEVICE_CLIENT_IDS", required_device_clients
    )
    if merged != source:
        write_preserving_newlines(env_file, merged)

    if missing:
        print(f"Added {len(missing)} missing key(s) to {env_file}:")
        for key, *_ in missing:
            print(f"  - {key}")
    if added_clients:
        print("Added local device/tool client IDs:")
        for client in added_clients:
            print(f"  - {client}")
    if not missing and not added_clients:
        print(f".env already has all expected keys and clients ({env_file}). Nothing to do.")


if __name__ == "__main__":
    main()
