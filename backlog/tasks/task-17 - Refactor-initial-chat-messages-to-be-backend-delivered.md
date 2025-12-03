---
id: task-17
title: Refactor initial chat messages to be backend-delivered
status: Done
assignee:
  - '@Claude'
created_date: '2025-12-03 19:30'
updated_date: '2025-12-03 22:18'
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
- [x] #1 Backend serves initial messages as response to implicit greeting
- [x] #2 Frontend removes setTimeout special case for initial messages
- [x] #3 Initial messages still use hardcoded content (not LLM-generated)
- [x] #4 Initial messages display with realistic delays and typing animations like normal messages

- [x] #5 Backend endpoint returns hardcoded initial message(s) in structured format
- [x] #6 Frontend sends implicit greeting on component mount to trigger initial messages
- [x] #7 Notification badge appears for 5 seconds when new message arrives
- [x] #8 Read indicator appears 800±400ms after user message is sent
- [x] #9 Multi-message delay derived from message length: pause between messages scales with typing duration (no fixed arbitrary delay)
- [x] #10 Thinking/reading delay: Sarah takes time proportional to received message length before typing response (40-80 chars/sec baseline, ±300ms variation)
- [x] #11 Typing indicator duration: shows while Sarah types her response (calculated from response message length: 40-80 chars/sec, ±300ms variation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Update backend chat API to serve initial messages:
   - Create handler for implicit greeting (empty/starter message)
   - Return hardcoded initial messages array with timing metadata
   - Messages formatted as JSON array: ["msg1", "msg2"]

2. Implement realistic timing calculations:
   - Thinking/reading delay: proportional to received message length (40-80 chars/sec, ±300ms)
   - Typing delay: proportional to response message length (40-80 chars/sec, ±300ms)
   - Multi-message delay: derived from typing duration of previous message
   - Helper function to calculate delays

3. Update frontend ChatPanel component:
   - Remove setTimeout special cases (lines 61-102)
   - Create implicit greeting message on mount
   - Send implicit greeting to trigger initial messages from backend
   - Route initial messages through normal displayMessages() pipeline

4. Implement visual indicators:
   - Typing indicator while thinking/typing
   - Read indicator appearing 800±400ms after user message
   - Notification badge appearing for 5 seconds on new message
   - Sequential message display with delays between them

5. Testing:
   - Verify initial messages appear with correct delays
   - Test typing indicators show/hide correctly
   - Verify notification badge timing
   - Test read indicator timing
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Refactored Initial Chat Messages to Backend-Delivered

### Changes Made

**Backend (app/api/chat/route.ts):**
- Added INITIAL_MESSAGES constant with hardcoded initial messages
- Detect implicit greeting (empty user message) and return hardcoded messages
- Replaced streaming (`streamText`) with non-streaming (`generateText`) for all responses
- All API responses now return JSON arrays of messages

**Frontend (components/ChatPanel.tsx):**
- Removed setTimeout special cases (old lines 61-102)
- Send implicit greeting on component mount to trigger initial messages
- Implemented message sequencing with realistic timing delays
- Added timing calculation utilities based on message length

**Timing System (lib/messageTiming.ts):**
- Implemented `calculateThinkingDelay()`: proportional to received message length (40-80 chars/sec ± 300ms)
- Implemented `calculateTypingDuration()`: proportional to response message length (40-80 chars/sec ± 300ms)
- Implemented `calculateInterMessageDelay()`: derived from previous message typing duration

### Implementation Details

1. **Initial Message Flow:**
   - App mounts → sends empty string message → backend returns hardcoded initial messages
   - Messages are parsed into array → sequenced with delays

2. **Message Display Sequencing:**
   - First message appears immediately with typewriter effect
   - Subsequent messages delayed based on previous message length
   - Typing indicator shows during delays
   - Notification badge appears for 5 seconds per message
   - Read indicator visible on user messages

3. **Realistic Timing:**
   - All delays calculated from message length (40-80 chars/sec baseline)
   - ±300ms variation added to each calculation
   - Thinking delay proportional to received message
   - Typing duration proportional to sent message
   - Multi-message delays derived from typing duration of previous message

### Technical Details

- No messages are streamed (all use `generateText`)
- Message parts sequenced via `visibleMessagePartCount` state
- Typing indicator shown during inter-message delays
- Notification badge triggers on new message part appearance
- All timers properly cleaned up on effect unmount
<!-- SECTION:NOTES:END -->
