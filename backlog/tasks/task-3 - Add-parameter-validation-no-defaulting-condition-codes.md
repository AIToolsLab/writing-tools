---
id: task-3
title: Add parameter validation - no defaulting condition codes
status: To Do
assignee: []
created_date: '2025-12-02 17:15'
labels:
  - study
  - validation
  - error-handling
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove default condition codes ('n') in PostTaskSurvey.tsx:18 and TaskPage.tsx:16. Should throw errors for missing/invalid condition codes to catch bugs early. Requires error boundary setup first (task-2).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Condition code validation added - throws on invalid/missing
- [ ] #2 Default fallback removed from both files
- [ ] #3 Error boundary catches and handles errors
<!-- AC:END -->
