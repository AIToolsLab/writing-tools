#!/usr/bin/env python3

import random
import string
from pathlib import Path

backend_path = Path(__file__).parent
env_file = backend_path / ".env"

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

with open(env_file, "w") as f:
    f.write(f'OPENAI_API_KEY="{openai_api_key}"\n')
    f.write(f'LOG_SECRET="{log_secret}"\n')

print(f".env file created at {env_file}")
