"""
Smoke tests for backend modules.

These tests verify that modules can be imported without errors.
This catches issues like:
- Missing dependencies
- Import-time exceptions
- Misconfigured environment variable handling
- To run locally: uv run pytest backend/tests/ -v
"""


def test_nlp_imports():
    """Verify the nlp module can be imported without errors."""
    import nlp  # noqa: F401

    # Verify critical attributes exist
    assert hasattr(nlp, "openai_client")
    assert hasattr(nlp, "get_suggestion")
    assert hasattr(nlp, "reflection")
    assert hasattr(nlp, "chat_stream")


def test_posthog_client_imports():
    """Verify the posthog_client module can be imported without errors.

    This is critical: the module must import successfully even when
    POSTHOG_API_KEY is not set.
    """
    import posthog_client  # noqa: F401

    # Verify the module has expected functions (they should be no-ops when disabled)
    assert hasattr(posthog_client, "capture_exception")
    assert hasattr(posthog_client, "capture_event")
    assert hasattr(posthog_client, "shutdown")

    # These functions should not raise even when PostHog is disabled
    posthog_client.capture_exception(Exception("test"))
    posthog_client.capture_event("test", "test_event")
    posthog_client.shutdown()


def test_server_imports():
    """Verify the server module can be imported without errors."""
    import server  # noqa: F401

    # Verify the FastAPI app is created
    assert hasattr(server, "app")
    assert server.app is not None


def test_server_routes_registered():
    """Verify expected API routes are registered."""
    import server

    routes = [route.path for route in server.app.routes]

    # Core API endpoints should exist
    assert "/api/ping" in routes
    assert "/api/get_suggestion" in routes
    assert "/api/reflections" in routes
    assert "/api/chat" in routes
    assert "/api/log" in routes
    assert "/api/test-error" in routes  # PostHog error tracking test endpoint
