"""
Test JWT validation functionality
"""
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from server import verify_token


@pytest.mark.asyncio
async def test_verify_demo_token():
    """Test that demo token is handled correctly"""
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", 
        credentials="demo-access-token"
    )
    
    result = await verify_token(credentials)
    
    assert result["sub"] == "demo-user"
    assert result["username"] == "demo"
    assert result["is_demo"] is True


@pytest.mark.asyncio
async def test_verify_no_token():
    """Test that missing token raises 401"""
    with pytest.raises(HTTPException) as exc_info:
        await verify_token(None)
    
    assert exc_info.value.status_code == 401
    assert "Authorization header required" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_verify_invalid_token():
    """Test that invalid token raises 401"""
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", 
        credentials="invalid-token"
    )
    
    with pytest.raises(HTTPException) as exc_info:
        await verify_token(credentials)
    
    assert exc_info.value.status_code == 401
    assert "Invalid token" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_verify_valid_jwt_token():
    """Test that a valid JWT token is decoded (without signature verification for now)"""
    # Create a simple JWT token for testing (no signature)
    import jwt
    payload = {"sub": "test-user", "aud": "textfocals.com", "iss": "https://textfocals.auth0.com/"}
    test_token = jwt.encode(payload, "secret", algorithm="HS256")
    
    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", 
        credentials=test_token
    )
    
    result = await verify_token(credentials)
    
    assert result["sub"] == "test-user"
    assert result["is_demo"] is False