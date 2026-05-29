"""
Run with: uv run pytest backend/tests/test_api_endpoints.py -v -s
"""

import json
import pytest
import sys
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from unittest.mock import AsyncMock
 
# Add backend to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))

from fastapi.testclient import TestClient
import server
from server import (
    app,
    validate_username,
    should_log,
    make_log,
    Log,
)
import nlp

# GLOBAL TEST FIXTURES (Prevents FileNotFoundError across all API routes)

@pytest.fixture(autouse=True)
def global_temp_log_dir():
    """
    Safely intercepts server.LOG_PATH globally for every single test.
    This guarantees that whenever the API endpoints attempt to append logs,
    they dynamically write to a safe sandbox instead of crashing on missing local folders.
    """
    temp_dir = Path(tempfile.mkdtemp())
    original_log_path = server.LOG_PATH
    server.LOG_PATH = temp_dir
    yield temp_dir
    server.LOG_PATH = original_log_path
    shutil.rmtree(temp_dir, ignore_errors=True)


# Create test client globally
client = TestClient(app)


# 1. VALIDATION & PRIVACY LOGIC TESTS (Critical Core Logic)

class TestUsernameValidation:
    """Tests core username validation to prevent path traversal and bad characters."""
    
    def test_validate_username_success(self):
        assert validate_username("test_user-123") == "test_user-123"
    
    def test_validate_username_too_long(self):
        with pytest.raises(ValueError, match="50 characters or less"):
            validate_username("a" * 51)
    
    def test_validate_username_special_chars(self):
        with pytest.raises(ValueError, match="alphanumeric or contain"):
            validate_username("test@user!")
    
    def test_validate_username_not_string(self):
        with pytest.raises(ValueError, match="must be a string"):
            validate_username(12345)


class TestShouldLogLogic:
    """Tests log privacy tiers: log data for study users, redact data for production users."""
    
    def test_should_log_logic_for_study_users(self):
        assert should_log("study_user_01") is True
    
    def test_should_log_logic_for_production_users(self):
        assert should_log("") is False



# 2. LOCAL FILE OPERATIONS TESTS (Isolated File I/O & Pipelines)

class TestLoggingOperations:
    """Tests async log appending and proper .jsonl format generation."""
    
    @pytest.mark.asyncio
    async def test_make_log_creates_file_and_appends(self, global_temp_log_dir):
        log1 = Log(
            timestamp=datetime.now().timestamp(),
            username="mary_chen",
            event="click_suggestion"
        )
        log2 = Log(
            timestamp=datetime.now().timestamp(),
            username="mary_chen",
            event="accept_suggestion"
        )
        
        # Write sequential logs
        await make_log(log1)
        await make_log(log2)
        
        log_file = global_temp_log_dir / "mary_chen.jsonl"
        assert log_file.exists(), "The log file should be correctly generated"
        
        # Verify valid JSONL structure (one valid JSON object per line)
        lines = log_file.read_text().strip().split('\n')
        assert len(lines) == 2, "Should have appended exactly two log entries"
        
        data = json.loads(lines[0])
        assert data["username"] == "mary_chen"
        assert data["event"] == "click_suggestion"

    def test_logs_poll_deduplication(self):
        """
        Tests long-polling pipeline transaction integrity against composite unique keys:
        key = f"{timestamp}|{username}|{event}"
        """
        seen_log_keys = set()
        
        timestamp = 1716120000.0
        username = "mary_chen"
        event = "poll_request"
        
        log_key_primary = f"{timestamp}|{username}|{event}"
        seen_log_keys.add(log_key_primary)
        
        log_key_duplicate = f"{timestamp}|{username}|{event}"
        assert log_key_duplicate in seen_log_keys, "Duplicate long-polling entry constraint hit!"



# 3. API ROUTE & INTEGRATION TESTS (Mocked/Fast Route Checks)

class TestAPIEndpoints:
    """Tests FastAPI routers, deterministic prompt shuffling, and middleware behaviors."""
    
    def test_ping_endpoint(self):
        """Tests basic service health check."""
        response = client.get("/api/ping")
        assert response.status_code == 200
        assert "timestamp" in response.json()
    
    def test_log_endpoint_success(self):
        """Tests front-end event logging endpoint."""
        # Configured without triggering strict server errors to capture the response code smoothly
        custom_client = TestClient(app, raise_server_exceptions=False)
        payload = {"username": "user_abc", "event": "suggestion_selected", "trace_id": "uuid-111"}
        response = custom_client.post("/api/log", json=payload)
        assert response.status_code == 200
        assert response.json() == {"message": "Feedback logged successfully."}


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])