"""
Smoke tests for backend modules.

These tests verify that modules can be imported without errors.
This catches issues like:
- Missing dependencies
- Import-time exceptions
- Misconfigured environment variable handling

The PostHog integration crash (Dec 2025) would have been caught by these tests.
"""


def test_nlp_imports():
    """Verify the nlp module can be imported without errors."""
    import nlp  # noqa: F401

    # Verify critical attributes exist
    assert hasattr(nlp, "openai_client")
    assert hasattr(nlp, "get_suggestion")
    assert hasattr(nlp, "reflection")
    assert hasattr(nlp, "chat_stream")


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
