---
id: TASK-25
title: Tune minimum screen-size / device gate thresholds
status: To Do
assignee: []
created_date: '2026-05-22 16:10'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The study has a screen-size gate (ScreenSizeCheck) that blocks participants on screens smaller than MIN_SCREEN_WIDTH x MIN_SCREEN_HEIGHT (currently 600x500) or on mobile devices. These thresholds were carried over from the old study and never tuned. Determine the smallest screen the experiment can reasonably run on without breaking the layout (chat panel + writing area + AI panel), and update the constants in lib/studyConfig.ts accordingly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Smallest usable viewport for TaskPage layout is empirically determined
- [ ] #2 MIN_SCREEN_WIDTH and MIN_SCREEN_HEIGHT in lib/studyConfig.ts reflect the determined values
- [ ] #3 Mobile detection in checkScreenSize() is reviewed against the old study's userAgent 'mobile' substring check
<!-- AC:END -->
