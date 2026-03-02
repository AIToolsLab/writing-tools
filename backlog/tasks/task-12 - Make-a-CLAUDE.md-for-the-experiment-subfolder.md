---
id: task-12
title: Make a CLAUDE.md for the experiment subfolder
status: Done
assignee:
  - '@myself'
created_date: '2025-12-03 01:55'
updated_date: '2025-12-03 22:00'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
We should also update the root folder CLAUDE.md accordingly.

There's a README.md in experiment that has some of the info, but it might be out of date.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Create CLAUDE.md in /experiment folder with project setup and architecture info
- [x] #2 Update root CLAUDE.md to clarify it applies to main app (backend/frontend) only
- [x] #3 Add section in root CLAUDE.md pointing to experiment/CLAUDE.md for separate instructions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create experiment/CLAUDE.md with:
   - Clarification that this is a separate app from main project
   - Project structure and tech stack
   - Package manager: npm (not uv)
   - Environment setup (.env.local with OPENAI_API_KEY)
   - Development commands
   - Testing setup with vitest
2. Update root CLAUDE.md:
   - Add section clarifying it applies to main app only
   - Add prominent note pointing to experiment/CLAUDE.md
3. Test that both documents are clear and non-conflicting
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created experiment/CLAUDE.md with straightforward setup instructions, emphasizing that `/experiment` is separate from `/backend` and `/frontend`. Updated root CLAUDE.md header to clearly point to separate CLAUDE.md files for each component.
<!-- SECTION:NOTES:END -->
