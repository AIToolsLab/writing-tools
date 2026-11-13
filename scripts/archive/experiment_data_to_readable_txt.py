import json
from pathlib import Path

# ===== CONFIG =====
LOGS_DIR = Path("")  # Update this path
# ==================


def safe_str(value):
    """Convert values safely to string."""
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        return json.dumps(value, indent=2, ensure_ascii=False)
    return str(value)


def write_user_file(user, output_dir: Path):
    username = user.get("username", "unknown_user")
    filepath = output_dir / f"{username}.txt"

    with filepath.open("w", encoding="utf-8") as f:
        f.write(f"USERNAME: {username}\n")
        f.write("=" * 80 + "\n\n")

        basic_fields = [
            "condition",
            "condition_code",
            "scenario",
            "wave",
            "final_word_count",
            "num_chat_messages_sent",
            "num_ai_suggestions_shown",
            "time_spent_writing_seconds",
            "num_document_updates",
        ]

        f.write("METADATA\n")
        f.write("-" * 40 + "\n")
        for field in basic_fields:
            if field in user:
                f.write(f"{field}: {safe_str(user.get(field))}\n")
        f.write("\n")

        f.write("FINAL EMAIL\n")
        f.write("-" * 40 + "\n")
        f.write(safe_str(user.get("final_email_text")) + "\n\n")

        chat_messages = user.get("chat_messages", [])
        if chat_messages:
            f.write("CHAT MESSAGES\n")
            f.write("-" * 40 + "\n")
            for msg in chat_messages:
                role = msg.get("role", "")
                timestamp = msg.get("timestamp", "")
                content = msg.get("content", "")
                f.write(f"[{timestamp}] {role.upper()}:\n{content}\n\n")
            f.write("\n")

        if "intro_survey" in user:
            f.write("INTRO SURVEY\n")
            f.write("-" * 40 + "\n")
            for k, v in user["intro_survey"].items():
                f.write(f"{k}: {safe_str(v)}\n")
            f.write("\n")

        if "post_task_survey" in user:
            f.write("POST-TASK SURVEY\n")
            f.write("-" * 40 + "\n")
            for k, v in user["post_task_survey"].items():
                f.write(f"{k}: {safe_str(v)}\n")
            f.write("\n")


def main():
    input_file = LOGS_DIR / "experiment_data.json"
    output_dir = LOGS_DIR / "experiment_data_txt"
    output_dir.mkdir(parents=True, exist_ok=True)

    with input_file.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        for user in data:
            write_user_file(user, output_dir)
    else:
        raise ValueError("Expected a list of users in the JSON.")

    print(f"Done. Files saved in: {output_dir}")


if __name__ == "__main__":
    main()
