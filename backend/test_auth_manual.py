"""
Simple test for authentication endpoints
"""
import requests
import time
import subprocess
import sys
import os
import signal
from pathlib import Path


def test_auth_endpoints():
    """Test authentication on live server"""
    
    print("Testing authentication endpoints...")
    
    # Test data
    generation_data = {
        "username": "test",
        "gtype": "Completion", 
        "prompt": "test prompt"
    }
    
    reflections_data = {
        "username": "test",
        "paragraph": "test paragraph",
        "prompt": "test prompt"
    }
    
    chat_data = {
        "messages": [{"role": "user", "content": "test"}],
        "username": "test"
    }
    
    base_url = "http://localhost:8000"
    
    # Test 1: Endpoints without auth should return 401
    print("1. Testing endpoints without authorization...")
    
    response = requests.post(f"{base_url}/api/generation", json=generation_data)
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    print("   ✓ /api/generation requires auth")
    
    response = requests.post(f"{base_url}/api/reflections", json=reflections_data)
    assert response.status_code == 401, f"Expected 401, got {response.status_code}" 
    print("   ✓ /api/reflections requires auth")
    
    response = requests.post(f"{base_url}/api/chat", json=chat_data)
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    print("   ✓ /api/chat requires auth")
    
    # Test 2: Demo token should work
    print("2. Testing demo token...")
    headers = {"Authorization": "Bearer demo-access-token"}
    
    response = requests.post(f"{base_url}/api/generation", json=generation_data, headers=headers)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    print("   ✓ /api/generation works with demo token")
    
    response = requests.post(f"{base_url}/api/reflections", json=reflections_data, headers=headers)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
    print("   ✓ /api/reflections works with demo token")
    
    # Test 3: Invalid token should return 401
    print("3. Testing invalid token...")
    headers = {"Authorization": "Bearer invalid-token"}
    
    response = requests.post(f"{base_url}/api/generation", json=generation_data, headers=headers)
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    print("   ✓ /api/generation rejects invalid token")
    
    response = requests.post(f"{base_url}/api/reflections", json=reflections_data, headers=headers)
    assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    print("   ✓ /api/reflections rejects invalid token")
    
    # Test 4: Ping should not require auth
    print("4. Testing ping endpoint...")
    response = requests.get(f"{base_url}/api/ping")
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    assert "timestamp" in response.json()
    print("   ✓ /api/ping works without auth")
    
    print("\n✅ All authentication tests passed!")


if __name__ == "__main__":
    test_auth_endpoints()