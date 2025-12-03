---
id: task-17
title: Refactor initial chat messages to be backend-delivered
status: To Do
assignee: []
created_date: '2025-12-03 19:30'
updated_date: '2025-12-03 19:39'
labels:
  - frontend
  - architecture
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Currently, the frontend has special-case logic to display Sarah's initial messages after a fixed delay. Instead, these messages should be delivered from the backend as if they were a response to an implicit initial greeting, treating them uniformly with all other messages through the normal message handling pipeline.

This eliminates frontend special cases and ensures initial messages get the same realistic timing as subsequent messages.

Realistic timing works as follows: Sarah finds a moment to read your message (~400-800ms), takes time to read and think through a response (depends on your message length), types an answer (depends on her response length), then sends it. The thinking/reading delay and typing duration both use the same calculation (40-80 chars/sec ± 300ms variation) but applied to different message lengths—Sarah thinks proportionally to what you wrote, and types proportionally to what she's typing. This creates natural pacing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Backend serves initial messages as response to implicit greeting
- [ ] #2 Frontend removes setTimeout special case for initial messages
- [ ] #3 Initial messages still use hardcoded content (not LLM-generated)
- [ ] #4 Initial messages display with realistic delays and typing animations like normal messages

- [ ] #5 Backend endpoint returns hardcoded initial message(s) in structured format
- [ ] #6 Frontend sends implicit greeting on component mount to trigger initial messages
- [ ] #7 Notification badge appears for 5 seconds when new message arrives
- [ ] #8 Read indicator appears 800±400ms after user message is sent
- [ ] #9 Multi-message delay derived from message length: pause between messages scales with typing duration (no fixed arbitrary delay)
- [ ] #10 Thinking/reading delay: Sarah takes time proportional to received message length before typing response (40-80 chars/sec baseline, ±300ms variation)
- [ ] #11 Typing indicator duration: shows while Sarah types her response (calculated from response message length: 40-80 chars/sec, ±300ms variation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Analyze prototype behavior:
   - Message read delay (~400-800ms after user sends)
   - Typing duration calculation (40-80 chars/sec, ±300ms variation)
   - Typing indicator animation
   - Message display with timestamp
   - Notification badge (shows for 5s)
   - Read indicator (appears 800±400ms after message)
   - Multi-message delay (300-400ms between messages)

2. Design backend response format:
   - Initial messages endpoint or implicit greeting trigger
   - Response format (array of message objects with content)
   - Determine if timing info comes from backend or frontend

3. Update frontend:
   - Trigger implicit greeting on mount
   - Remove setTimeout special case (lines 569-579)
   - Route initial messages through normal displayMessages() pipeline

4. Test:
   - Initial messages appear with correct delays
   - Typing indicator shows/hides correctly
   - Notifications badge appears and disappears
   - Read indicator timing matches prototype
<!-- SECTION:PLAN:END -->
