import unittest

from scripts.get_env import merge_csv_assignment


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


if __name__ == "__main__":
    unittest.main()
