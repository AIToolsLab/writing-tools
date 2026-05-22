---
id: TASK-24
title: Add backend API contract tests for /api/get_suggestion
status: To Do
assignee: []
created_date: '2026-05-21 17:29'
labels:
  - backend
  - testing
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

`frontend/tests/mockBackend.ts` mocks `/api/get_suggestion` and bakes in an assumption about the backend response shape (`{generation_type, result, extra_data}`, where `result` is a `\n\n`-separated markdown bullet list). Nothing verifies that assumption against the real backend, so the mock can silently drift out of sync — the frontend Playwright tests would keep passing against a stale mock (false confidence).

## Goal

Add `backend/tests/test_api_contract.py` that drives the FastAPI app with `TestClient`, stubs OpenAI with `respx` (no real network calls), and asserts `/api/get_suggestion` produces the structure the frontend mock relies on. Fix `mockBackend.ts` wherever it diverges from verified behavior.

## Notes for whoever picks this up

- `respx` intercepts `httpx` (the OpenAI SDK transport); it is the "fake OpenAI" layer, NOT the test driver. The driver is FastAPI's `TestClient`.
- Run respx in non-strict mode (`@respx.mock(assert_all_mocked=False)`) so the in-process ASGI requests pass through and only `api.openai.com` is intercepted.
- For structured-output gtypes, the canned OpenAI response's `message.content` must be valid JSON matching `ListResponse`, e.g. `{"responses": ["a", "b", "c"]}`.
- `mockBackend.ts` only covers the happy path for three list-type gtypes. `example_rewording` (empty selection), `complete_document`, and the invalid-gtype case are uncovered but part of the real contract.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /api/get_suggestion tests stub OpenAI via respx so the suite makes no real network calls
- [ ] #2 List-type gtypes (e.g. example_sentences) return result as a \n\n-separated markdown bullet list and extra_data as an object
- [ ] #3 example_rewording with an empty selection returns the 'please select text' message rather than a bullet list
- [ ] #4 complete_document returns plain prose, not a bulleted list
- [ ] #5 An invalid gtype produces an error response with a documented status code
- [ ] #6 Every /api/get_suggestion response validates against the {generation_type, result, extra_data} structure
- [ ] #7 frontend/tests/mockBackend.ts is updated to match verified backend behavior wherever the two diverge
<!-- AC:END -->
