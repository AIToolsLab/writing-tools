import ast
import os
from pathlib import Path
from typing import Any

import pytest

# Fake key only for constructing client objects.
# This test does NOT call OpenAI.
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

NLP_FILE = Path(__file__).resolve().parents[1] / "nlp.py"

def get_attr_path(node: ast.AST) -> list[str]:
    """
    Convert an AST attribute chain into a list.

    Example:
        openai_client.beta.chat.completions.parse(...)

    becomes:
        ["openai_client", "beta", "chat", "completions", "parse"]
    """

    if isinstance(node, ast.Name):
        return [node.id]

    if isinstance(node, ast.Attribute):
        return get_attr_path(node.value) + [node.attr]

    return []


def find_openai_client_call_paths() -> list[tuple[list[str], int]]:
    """
    Scan backend/nlp.py and find real calls starting with openai_client.

    Finds:
        openai_client.beta.chat.completions.parse(...)
        openai_client.chat.completions.create(...)

    Ignores:
        dummy_client.chat.completions.create(...)

    because dummy_client is only used for warmup.
    """

    source = NLP_FILE.read_text(encoding="utf-8")
    tree = ast.parse(source)

    paths: list[tuple[list[str], int]] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue

        path = get_attr_path(node.func)

        if path and path[0] == "openai_client":
            paths.append((path, node.lineno))

    return paths


def strict_has_attr(obj: Any, attr: str) -> bool:
    """
    Stricter than hasattr().

    hasattr(obj, attr) calls getattr(obj, attr). That can be too weak for
    dynamic wrapper/proxy objects, because they may return something even for
    paths that are not truly exposed.

    dir(obj) is stricter because it checks the public attribute surface.
    """

    return attr in dir(obj)


def assert_path_exists_on_client(client: Any, path: list[str], lineno: int) -> None:
    """
    Strictly check whether the path used in backend/nlp.py exists on the real
    PostHog-wrapped OpenAI client.

    Example:
        openai_client.beta.chat.completions.parse

    checks:
        wrapped_client.beta.chat.completions.parse
    """

    current = client
    checked_parts = [path[0]]

    for attr in path[1:]:
        checked_parts.append(attr)

        if not strict_has_attr(current, attr):
            full_path = ".".join(path)
            failed_path = ".".join(checked_parts)

            raise AssertionError(
                f"\nInvalid OpenAI client path in backend/nlp.py line {lineno}:\n"
                f"  {full_path}\n\n"
                f"The actual PostHog-wrapped OpenAI client does not publicly expose:\n"
                f"  {failed_path}\n\n"
                f"Current object type before missing attr:\n"
                f"  {type(current)}\n\n"
                f"This test uses dir(), not hasattr(), because hasattr() can be "
                f"fooled by dynamic proxy objects."
            )

        current = getattr(current, attr)


def build_actual_posthog_wrapped_openai_client() -> Any:
    """
    Build the real PostHog-wrapped OpenAI client object.

    This does NOT call OpenAI.
    This does NOT send data to PostHog.
    """

    from posthog import Posthog
    from posthog.ai.openai import AsyncOpenAI as PostHogAsyncOpenAI

    posthog_client = Posthog(
        project_api_key="test-posthog-key",
        host="https://us.i.posthog.com",
        disabled=True,
    )

    try:
        return PostHogAsyncOpenAI(
            api_key="test-openai-key",
            posthog_client=posthog_client,
        )
    except TypeError:
        # Some SDK versions may not accept posthog_client as a keyword.
        return PostHogAsyncOpenAI(
            api_key="test-openai-key",
        )


def test_wrong_chat_parse_path_fails_on_wrapped_client():
    """
    Negative control.

    This proves the checker is strong enough.

    openai_client.chat.completions.parse should NOT be accepted.
    Structured parsing should go through:
        openai_client.beta.chat.completions.parse
    """

    wrapped_client = build_actual_posthog_wrapped_openai_client()

    wrong_path = [
        "openai_client",
        "chat",
        "completions",
        "parse",
    ]

    with pytest.raises(AssertionError):
        assert_path_exists_on_client(
            wrapped_client,
            wrong_path,
            lineno=0,
        )


def test_nlp_openai_paths_exist_on_actual_posthog_wrapped_client():
    """
    Contract test.

    Scan backend/nlp.py for every openai_client.xxx(...) call and check whether
    that exact path exists on the actual PostHog-wrapped OpenAI client.

    This does NOT call OpenAI.
    """

    wrapped_client = build_actual_posthog_wrapped_openai_client()

    paths = find_openai_client_call_paths()

    assert paths, (
        f"No real openai_client calls found in:\n"
        f"  {NLP_FILE}\n\n"
        f"This means AST did not find real code like:\n"
        f"  openai_client.chat.completions.create(...)\n"
        f"  openai_client.beta.chat.completions.parse(...)\n"
    )

    for path, lineno in paths:
        assert_path_exists_on_client(wrapped_client, path, lineno)