---
id: task-10
title: Log chat interactions
status: In Progress
assignee:
  - '@claude'
created_date: '2025-12-03 00:57'
updated_date: '2025-12-03 02:03'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Chat messages sent and "received" must be logged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Log user messages sent to the chat
- [x] #2 Log assistant messages received from the chat
- [x] #3 Include message content, timestamps, and role in logs
- [ ] #4 Verify logs appear in backend log files
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Understand current logging infrastructure:
   - Backend: no logging in the `experiment` server (there is in the main-app `backend` but that's separate)
   - Frontend: log() function available in src/api/index.ts sends logs to /api/log

2. Add client-side logging to ChatPanel component:
   - Import log() function from src/api/index.ts
   - Log user messages when sendMessage is called
   - Log assistant messages when they appear in the messages array
   - Include relevant metadata (message role, content, timestamp)

3. Test logging:
   - Send test messages through chat
   - Verify logs appear in backend log files
   - Check log format and content
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Added new LogEventType events: chatMessage:user and chatMessage:assistant
- Imported log function and studyParamsAtom into ChatPanel component
- Moved getMessageText and parseMessageContent to module-level functions
- Added useEffect to track and log messages as they are added to the messages array
- Logs include messageId, content, and timestamp in extra_data
- Build succeeds with no TypeScript errors
<!-- SECTION:NOTES:END -->
