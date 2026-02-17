"""
Pytest configuration for backend tests.

Sets up required environment variables before any imports occur.
"""

import os
import sys

# Add backend directory to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set dummy API key for tests - must happen before importing nlp/server
# This allows import-time validation to pass
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy-key-for-ci-testing")
