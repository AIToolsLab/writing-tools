"""
PostHog client initialization for error tracking.

This module provides optional PostHog integration. If POSTHOG_API_KEY
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
import sys
import traceback
from typing import Any, Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Environment configuration
POSTHOG_API_KEY = (os.getenv("POSTHOG_API_KEY") or "").strip()
POSTHOG_HOST = (os.getenv("POSTHOG_HOST") or "https://us.i.posthog.com").strip()

# Initialize PostHog client (None if not configured)
posthog_client: Optional[Any] = None

if POSTHOG_API_KEY:
    try:
        from posthog import Posthog

        posthog_client = Posthog(
            project_api_key=POSTHOG_API_KEY,
            host=POSTHOG_HOST,
        )
        logger.info(f"PostHog error tracking initialized (host: {POSTHOG_HOST})")
    except Exception as e:
        logger.warning(f"Failed to initialize PostHog client: {e}")
        posthog_client = None
else:
    logger.info("POSTHOG_API_KEY not set - error tracking disabled")


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
    if posthog_client is None:
        return

    try:
        # Build exception properties
        exc_type = type(exception).__name__
        exc_message = str(exception)
        exc_traceback = "".join(
            traceback.format_exception(type(exception), exception, exception.__traceback__)
        )

        error_properties = {
            "$exception_type": exc_type,
            "$exception_message": exc_message,
            "$exception_stack_trace_raw": exc_traceback,
            "exception_type": exc_type,
            "exception_message": exc_message,
        }

        if properties:
            error_properties.update(properties)

        posthog_client.capture(
            distinct_id=distinct_id,
            event="$exception",
            properties=error_properties,
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
    if posthog_client is None:
        return

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
    if posthog_client is not None:
        try:
            posthog_client.shutdown()
        except Exception as e:
            logger.warning(f"Error shutting down PostHog client: {e}")
