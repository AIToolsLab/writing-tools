"""
PostHog client initialization for error tracking.

This module provides optional PostHog integration. If POSTHOG_PROJECT_TOKEN
is not set, all tracking functions become no-ops and the application
continues to work normally.

Usage:
    from posthog_client import capture_exception, capture_event, posthog_client

    # In exception handlers:
    capture_exception(exc, {"path": "/api/foo", "user_id": "123"})

    # For custom events:
    capture_event("backend-server", "api_error", {"status_code": 500})
"""

import logging
import os
from contextlib import contextmanager
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Environment configuration
POSTHOG_PROJECT_TOKEN = (os.getenv("POSTHOG_PROJECT_TOKEN") or "").strip()
POSTHOG_HOST = (os.getenv("POSTHOG_HOST") or "https://us.i.posthog.com").strip()

from posthog import Posthog, identify_context, new_context

# PostHog is always instantiated so the rest of the codebase has a single code
# path with no None checks. When no token is configured it runs in `disabled`
# mode, where all capture calls become safe no-ops.
if POSTHOG_PROJECT_TOKEN:
    posthog_client: Posthog = Posthog(
        project_api_key=POSTHOG_PROJECT_TOKEN,
        host=POSTHOG_HOST,
    )
    logger.info(f"PostHog error tracking initialized (host: {POSTHOG_HOST})")
else:
    posthog_client = Posthog(
        project_api_key="disabled",
        host=POSTHOG_HOST,
        disabled=True,
    )
    logger.info("POSTHOG_PROJECT_TOKEN not set - PostHog running in disabled mode")


def capture_exception(
    exception: BaseException,
    properties: Optional[dict[str, Any]] = None,
    distinct_id: str = "backend-server",
) -> None:
    """
    Capture an exception to PostHog for error tracking.

    Args:
        exception: The exception to capture
        properties: Additional properties to include with the error
        distinct_id: The user/system identifier (defaults to "backend-server")
    """
    try:
        posthog_client.capture_exception(
            exception,
            distinct_id=distinct_id,
            properties=properties or {},
        )
    except Exception as e:
        # Never let PostHog errors break the application
        logger.warning(f"Failed to capture exception to PostHog: {e}")


def capture_event(
    distinct_id: str,
    event: str,
    properties: Optional[dict[str, Any]] = None,
) -> None:
    """
    Capture a custom event to PostHog.

    Args:
        distinct_id: The user/system identifier
        event: The event name
        properties: Additional properties to include with the event
    """
    try:
        posthog_client.capture(
            distinct_id=distinct_id,
            event=event,
            properties=properties or {},
        )
    except Exception as e:
        # Never let PostHog errors break the application
        logger.warning(f"Failed to capture event to PostHog: {e}")


def shutdown() -> None:
    """Flush and shutdown the PostHog client gracefully."""
    try:
        posthog_client.shutdown()
    except Exception as e:
        logger.warning(f"Error shutting down PostHog client: {e}")


@contextmanager
def user_context(distinct_id: str):
    """Scope a request to a PostHog distinct_id.

    Events captured within the context - including the OpenAI wrapper's
    `$ai_generation` events - are attributed to this user automatically, so
    call sites don't need to thread a distinct_id through to the LLM layer.
    """
    with new_context(capture_exceptions=False):
        identify_context(distinct_id or "backend-server")
        yield
