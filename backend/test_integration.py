"""
Integration test for JWT validation
"""
import asyncio
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
import sys
import os

# Add the backend directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))

# Mock the nlp module to avoid dependencies
nlp_mock = AsyncMock()
nlp_mock.chat_completion = AsyncMock(return_value=type('MockResult', (), {'result': 'test result', 'extra_data': {}})())
nlp_mock.reflection = AsyncMock(return_value=type('MockResult', (), {'result': 'test reflection', 'extra_data': {}})())
nlp_mock.chat_stream = AsyncMock()

with patch.dict(sys.modules, {'nlp': nlp_mock}):
    from server import app

client = TestClient(app)


def test_generation_endpoint_without_token():
    """Test that generation endpoint requires authentication"""
    response = client.post("/api/generation", json={
        "username": "test",
        "gtype": "Completion", 
        "prompt": "test prompt"
    })
    assert response.status_code == 401
    assert "Authorization header required" in response.json()["detail"]


def test_generation_endpoint_with_demo_token():
    """Test that demo token works"""
    response = client.post("/api/generation", json={
        "username": "test",
        "gtype": "Completion", 
        "prompt": "test prompt"
    }, headers={"Authorization": "Bearer demo-access-token"})
    
    # Should succeed (status 200)
    assert response.status_code == 200


def test_generation_endpoint_with_invalid_token():
    """Test that invalid token returns 401"""
    response = client.post("/api/generation", json={
        "username": "test",
        "gtype": "Completion", 
        "prompt": "test prompt"
    }, headers={"Authorization": "Bearer invalid-token"})
    
    assert response.status_code == 401
    assert "Invalid token" in response.json()["detail"]


def test_reflections_endpoint_without_token():
    """Test that reflections endpoint requires authentication"""
    response = client.post("/api/reflections", json={
        "username": "test",
        "paragraph": "test paragraph",
        "prompt": "test prompt"
    })
    assert response.status_code == 401


def test_reflections_endpoint_with_demo_token():
    """Test that reflections work with demo token"""
    response = client.post("/api/reflections", json={
        "username": "test",
        "paragraph": "test paragraph", 
        "prompt": "test prompt"
    }, headers={"Authorization": "Bearer demo-access-token"})
    
    assert response.status_code == 200


def test_chat_endpoint_without_token():
    """Test that chat endpoint requires authentication"""
    response = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "test"}],
        "username": "test"
    })
    assert response.status_code == 401


def test_ping_endpoint_no_auth_required():
    """Test that ping endpoint doesn't require authentication"""
    response = client.get("/api/ping")
    assert response.status_code == 200
    assert "timestamp" in response.json()


def test_generation_with_valid_jwt():
    """Test with a valid JWT token (no signature verification)"""
    import jwt
    payload = {"sub": "test-user", "aud": "textfocals.com", "iss": "https://textfocals.auth0.com/"}
    test_token = jwt.encode(payload, "secret", algorithm="HS256")
    
    response = client.post("/api/generation", json={
        "username": "test",
        "gtype": "Completion", 
        "prompt": "test prompt"
    }, headers={"Authorization": f"Bearer {test_token}"})
    
    assert response.status_code == 200