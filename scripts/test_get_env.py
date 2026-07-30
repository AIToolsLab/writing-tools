import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.get_env import (
    existing_entries,
    merge_csv_assignment,
    prompt_demo_openai_key,
    resolved,
)


class MergeCsvAssignmentTests(unittest.TestCase):
    def test_preserves_quotes_comment_and_crlf(self):
        source = 'OTHER=1\r\nBETTER_AUTH_DEVICE_CLIENT_IDS="custom,mindmap"  # keep me\r\n'
        merged, added = merge_csv_assignment(
            source,
            "BETTER_AUTH_DEVICE_CLIENT_IDS",
            ["writing-tools-editor-dev", "mindmap"],
        )
        self.assertEqual(added, ["writing-tools-editor-dev"])
        self.assertEqual(
            merged,
            'OTHER=1\r\nBETTER_AUTH_DEVICE_CLIENT_IDS="custom,mindmap,writing-tools-editor-dev"  # keep me\r\n',
        )

    def test_is_idempotent_and_returns_the_original_text(self):
        source = "BETTER_AUTH_DEVICE_CLIENT_IDS='mindmap,writing-tools-editor-dev'\n"
        merged, added = merge_csv_assignment(
            source,
            "BETTER_AUTH_DEVICE_CLIENT_IDS",
            ["mindmap", "writing-tools-editor-dev"],
        )
        self.assertIs(merged, source)
        self.assertEqual(added, [])


class ExistingEntriesTests(unittest.TestCase):
    def test_reads_values_ignoring_quotes_blanks_and_comments(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env"
            path.write_text(
                '# a comment\n\nOPENAI_API_KEY="sk-quoted"\n'
                "BETTER_AUTH_ENABLED=false\nEMPTY=\n"
            )
            self.assertEqual(
                existing_entries(path),
                {
                    "OPENAI_API_KEY": "sk-quoted",
                    "BETTER_AUTH_ENABLED": "false",
                    "EMPTY": "",
                },
            )

    def test_missing_file_has_no_entries(self):
        self.assertEqual(existing_entries(Path("/nonexistent/.env")), {})


class PromptDemoOpenAIKeyTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(resolved.clear)
        resolved.clear()

    def test_empty_answer_reuses_the_main_key(self):
        resolved["OPENAI_API_KEY"] = "sk-main"
        with patch("builtins.input", return_value=""):
            self.assertEqual(prompt_demo_openai_key(), "sk-main")

    def test_a_separate_demo_key_wins_over_the_main_key(self):
        resolved["OPENAI_API_KEY"] = "sk-main"
        with patch("builtins.input", return_value="sk-demo"):
            self.assertEqual(prompt_demo_openai_key(), "sk-demo")

    def test_prompts_outright_when_there_is_no_main_key_to_reuse(self):
        with patch("builtins.input", return_value="sk-demo") as mock_input:
            self.assertEqual(prompt_demo_openai_key(), "sk-demo")
        mock_input.assert_called_once()

    def test_rejects_a_key_that_is_not_an_openai_key(self):
        resolved["OPENAI_API_KEY"] = "sk-main"
        with patch("builtins.input", return_value="nonsense"):
            with self.assertRaises(SystemExit):
                prompt_demo_openai_key()


if __name__ == "__main__":
    unittest.main()
