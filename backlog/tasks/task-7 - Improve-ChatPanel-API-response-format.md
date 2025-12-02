---
id: task-7
title: Improve ChatPanel API response format
status: To Do
assignee: []
created_date: '2025-12-02 17:17'
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
