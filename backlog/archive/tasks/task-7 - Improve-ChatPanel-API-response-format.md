---
id: task-7
title: Improve ChatPanel API response format
status: In Progress
assignee:
  - '@myself'
created_date: '2025-12-02 17:17'
updated_date: '2025-12-03 21:47'
labels:
  - study
  - chatpanel
  - api
  - refactor
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instead of current markdown parsing approach (ChatPanel.tsx:94), have backend return structured JSON object directly. Eliminates need for client-side parsing and reduces coupling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Backend API updated to return structured JSON
- [ ] #2 ChatPanel updated to consume structured response
- [ ] #3 Markdown parsing logic removed
- [ ] #4 Integration tests pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze current response structure from OpenAI API and define target JSON schema
2. Update backend to transform OpenAI responses into structured JSON format
3. Update frontend ChatPanel to consume structured response
4. Remove markdown parsing logic from ChatPanel.tsx
5. Update integration tests to match new response format
6. Test end-to-end flow to ensure messages display correctly
<!-- SECTION:PLAN:END -->
