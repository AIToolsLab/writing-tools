#!/bin/bash
curl -X POST -H "Content-Type: application/json" -d '{"username": "test", "gtype": "Completion", "prompt": "This is a test prompt."}' https://textfocals.com/api/generation
