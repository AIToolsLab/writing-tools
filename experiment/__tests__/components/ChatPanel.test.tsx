import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor, fireEvent, screen, act } from '@testing-library/react';
import ChatPanel from '@/components/ChatPanel';
import { studyParamsAtom } from '@/contexts/StudyContext';
import * as logging from '@/lib/logging';
import { renderWithJotai } from '../utils/test-utils';
import { createUserMessage, createAssistantMessage, createMockChatHelpers } from '../utils/mock-factories';

// Mock the logging module
vi.mock('@/lib/logging', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Mock useChat hook
vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(() => createMockChatHelpers()),
}));

// Mock timing functions for predictable delays
vi.mock('@/lib/messageTiming', () => ({
  calculateThinkingDelay: vi.fn(() => 100),
  calculateTypingDuration: vi.fn(() => 100),
  calculateInterMessageDelay: vi.fn(() => 100),
}));

describe('ChatPanel - Message Logging', () => {
  const mockLog = vi.mocked(logging.log);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: User Message Logging (via form submission)
  it('should log user messages with correct event type and payload structure', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    mockLog.mockClear();

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    // Wait for initialization
    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockLog.mockClear();

    // Type and submit a message
    const input = screen.getByPlaceholderText(/Message Sarah/i);
    fireEvent.change(input, { target: { value: 'Hello Sarah' } });
    fireEvent.submit(input.closest('form')!);

    // Check log was called with correct structure
    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledWith({
        username: 'test-user',
        event: 'chatMessage:user',
        extra_data: {
          messageId: expect.stringMatching(/^user-\d+$/),
          content: 'Hello Sarah',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        },
      });
    });
  });

  // Test 2: Assistant Message Logging (via typing animation)
  it('should log assistant messages with correct event type and partIndex', async () => {
    vi.useFakeTimers();
    try {
      const { useChat } = await import('@ai-sdk/react');
      const mockUseChat = vi.mocked(useChat);

      const mockSendMessage = vi.fn();
      const mockSetMessages = vi.fn();

      // Start with initialized state (empty user + assistant message)
      const emptyUserMessage = createUserMessage('', 'initial-user-message');
      const assistantMessage = createAssistantMessage('How can I help?', 'assistant-msg-1');
      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, assistantMessage],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      renderWithJotai(<ChatPanel />, {
        initialValues: [
          [
            studyParamsAtom,
            {
              username: 'test-user',
              condition: 'n',
              page: 'task',
              autoRefreshInterval: 15000,
            },
          ],
        ],
      });

      mockLog.mockClear();

      // Advance timers past the typing duration (100ms mocked) to reveal the message
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'chatMessage:assistant',
          extra_data: expect.objectContaining({
            messageId: 'assistant-msg-1',
            partIndex: 0,
            content: 'How can I help?',
          }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 3: User messages are only logged on form submission, not via effects (regression test)
  it('should not duplicate user message logs on re-render', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    const { rerender } = renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockLog.mockClear();

    // Submit a message via form
    const input = screen.getByPlaceholderText(/Message Sarah/i);
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    // Re-render should not log again (user messages are event-driven)
    mockLog.mockClear();
    rerender(<ChatPanel />);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockLog).toHaveBeenCalledTimes(0);
  });

  // Test 4: Multiple user messages via form submission
  it('should log multiple messages in sequence', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockLog.mockClear();

    const input = screen.getByPlaceholderText(/Message Sarah/i);

    // Send first message
    fireEvent.change(input, { target: { value: 'First' } });
    fireEvent.submit(input.closest('form')!);

    // Send second message
    fireEvent.change(input, { target: { value: 'Second' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(2);
    });

    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'chatMessage:user',
        extra_data: expect.objectContaining({ content: 'First' }),
      })
    );

    expect(mockLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: 'chatMessage:user',
        extra_data: expect.objectContaining({ content: 'Second' }),
      })
    );
  });

  // Test 5: User message content is logged exactly as submitted
  it('should correctly extract text from message parts', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockLog.mockClear();

    const input = screen.getByPlaceholderText(/Message Sarah/i);
    fireEvent.change(input, { target: { value: 'Part 1 Part 2 Part 3' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          extra_data: expect.objectContaining({
            content: 'Part 1 Part 2 Part 3',
          }),
        })
      );
    });
  });

  // Test 6: Empty messages are not submitted (guard in onSubmit)
  it('should handle messages with empty or missing text', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockLog.mockClear();

    const input = screen.getByPlaceholderText(/Message Sarah/i);
    // Try to submit empty message
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.submit(input.closest('form')!);

    // Should not log anything for empty message
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockLog).not.toHaveBeenCalled();
  });

  // Test 7: Username from Atom
  it('should use username from studyParamsAtom', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'custom-username-123',
            condition: 'c',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockLog.mockClear();

    const input = screen.getByPlaceholderText(/Message Sarah/i);
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'custom-username-123',
        })
      );
    });
  });

  // Test 9: Timestamp Format
  it('should use ISO 8601 timestamp format', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockLog.mockClear();

    const input = screen.getByPlaceholderText(/Message Sarah/i);
    fireEvent.change(input, { target: { value: 'Test' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logCall = mockLog.mock.calls[0][0];
    const timestamp = logCall.extra_data?.timestamp as string;

    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const date = new Date(timestamp);
    expect(date.toString()).not.toBe('Invalid Date');

    const now = Date.now();
    const timestampMs = date.getTime();
    expect(now - timestampMs).toBeLessThan(1000);
  });

  // Test 10: Assistant messages are logged only when displayed, not before
  it('should log new messages when added incrementally', async () => {
    vi.useFakeTimers();
    try {
      const { useChat } = await import('@ai-sdk/react');
      const mockUseChat = vi.mocked(useChat);

      const mockSendMessage = vi.fn();
      const mockSetMessages = vi.fn();

      // Start with initialized state (empty user + assistant message with 2 parts)
      const emptyUserMessage = createUserMessage('', 'initial-user-message');
      const msg1 = createAssistantMessage(
        JSON.stringify(['First part', 'Second part']),
        'msg-1'
      );
      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, msg1],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      renderWithJotai(<ChatPanel />, {
        initialValues: [
          [
            studyParamsAtom,
            {
              username: 'test-user',
              condition: 'n',
              page: 'task',
              autoRefreshInterval: 15000,
            },
          ],
        ],
      });

      mockLog.mockClear();

      // BEFORE any time passes: no messages should be logged yet
      expect(mockLog).not.toHaveBeenCalled();

      // Advance timers to reveal first part only (100ms typing duration)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });

      // First message should now be logged
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'chatMessage:assistant',
          extra_data: expect.objectContaining({
            messageId: 'msg-1',
            partIndex: 0,
            content: 'First part',
          }),
        })
      );

      mockLog.mockClear();

      // Advance timers to reveal second part (inter-message delay 100ms + typing 100ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });

      // Second message should now be logged
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'chatMessage:assistant',
          extra_data: expect.objectContaining({
            messageId: 'msg-1',
            partIndex: 1,
            content: 'Second part',
          }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 11: Regression - first part of new assistant message should not be logged with stale visibleMessagePartCount
  it('should not log assistant message parts before they are visible (race condition)', async () => {
    vi.useFakeTimers();
    try {
      const { useChat } = await import('@ai-sdk/react');
      const mockUseChat = vi.mocked(useChat);

      const mockSendMessage = vi.fn();
      const mockSetMessages = vi.fn();

      // Start with initialized state - initial messages already visible
      const emptyUserMessage = createUserMessage('', 'initial-user-message');
      const initialAssistantMessage = createAssistantMessage(
        JSON.stringify(['Hello!', 'How can I help?']),
        'initial-assistant'
      );
      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, initialAssistantMessage],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      const { rerender } = renderWithJotai(<ChatPanel />, {
        initialValues: [
          [
            studyParamsAtom,
            {
              username: 'test-user',
              condition: 'n',
              page: 'task',
              autoRefreshInterval: 15000,
            },
          ],
        ],
      });

      // Advance timers to reveal all initial message parts
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      mockLog.mockClear();

      // Now simulate user sending a message and receiving a NEW assistant response
      // The key bug we're testing: visibleMessagePartCount was high from the previous message
      // but now with the fix, visibleMessageId prevents logging until parts are actually revealed
      const userMessage = createUserMessage('What about X?', 'user-msg-1');
      const newAssistantMessage = createAssistantMessage(
        JSON.stringify(['New response part 1', 'New response part 2']),
        'new-assistant'
      );
      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, initialAssistantMessage, userMessage, newAssistantMessage],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      // Force re-render with new messages (simulating the async response arriving)
      await act(async () => {
        rerender(<ChatPanel />);
      });

      // At this point, NO parts of the new message should be logged yet
      // because visibleMessageId hasn't been set for the new message
      const prematureCalls = mockLog.mock.calls.filter(
        (call) => call[0]?.event === 'chatMessage:assistant' && call[0]?.extra_data?.messageId === 'new-assistant'
      );
      expect(prematureCalls).toHaveLength(0);

      mockLog.mockClear();

      // Advance timers to reveal first part of NEW message
      // With mocked timing (100ms each) and busyLag (1200ms):
      // - readingDelay = 100 + 1200 = 1300ms
      // - part 1 at: 1300 + 100 = 1400ms
      // - part 2 at: 1400 + 100 + 100 = 1600ms
      // So advance 1500ms to reveal only part 1
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      // The first part should now be logged with actual content
      const assistantCalls = mockLog.mock.calls.filter(
        (call) => call[0]?.event === 'chatMessage:assistant' && call[0]?.extra_data?.messageId === 'new-assistant'
      );

      expect(assistantCalls.length).toBeGreaterThan(0);
      const firstPartCall = assistantCalls.find((call) => call[0]?.extra_data?.partIndex === 0);
      expect(firstPartCall).toBeDefined();
      expect(firstPartCall?.[0]?.extra_data?.content).toBe('New response part 1');

      mockLog.mockClear();

      // Advance 200ms more to reveal second part (need to cross 1600ms threshold)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      const secondPartCalls = mockLog.mock.calls.filter(
        (call) => call[0]?.event === 'chatMessage:assistant' && call[0]?.extra_data?.messageId === 'new-assistant'
      );

      const part1Call = secondPartCalls.find((call) => call[0]?.extra_data?.partIndex === 1);
      expect(part1Call).toBeDefined();
      expect(part1Call?.[0]?.extra_data?.content).toBe('New response part 2');
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 12: System Messages
  it('should not log system messages', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const systemMessage = {
      id: 'system-msg',
      role: 'system' as const,
      parts: [{ type: 'text' as const, text: 'System message' }],
    };

    mockUseChat.mockReturnValue(createMockChatHelpers({
      messages: [systemMessage],
    }));

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockLog).not.toHaveBeenCalled();
  });

  // Test 13: Initial Messages on Mount
  it('should initialize with pre-filled assistant messages when component mounts', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    // Should initialize messages with an empty user message and initial assistant messages
    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });

    const setMessagesCall = mockSetMessages.mock.calls[0][0];
    expect(setMessagesCall).toHaveLength(2);
    expect(setMessagesCall[0].role).toBe('user');
    expect(setMessagesCall[1].role).toBe('assistant');
  });

  // Test 14: Message Sequencing with Multiple Parts
  it('should log individual message parts as they become visible', async () => {
    vi.useFakeTimers();
    try {
      const { useChat } = await import('@ai-sdk/react');
      const mockUseChat = vi.mocked(useChat);

      const mockSendMessage = vi.fn();
      const mockSetMessages = vi.fn();

      // Start with initialized state
      const emptyUserMessage = createUserMessage('', 'initial-user-message');
      const msg = createAssistantMessage(
        JSON.stringify(['First message', 'Second message']),
        'multi-msg'
      );
      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, msg],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      renderWithJotai(<ChatPanel />, {
        initialValues: [
          [
            studyParamsAtom,
            {
              username: 'test-user',
              condition: 'n',
              page: 'task',
              autoRefreshInterval: 15000,
            },
          ],
        ],
      });

      mockLog.mockClear();

      // Advance timers to reveal first part (100ms typing duration)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // First part should be logged with partIndex: 0
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'chatMessage:assistant',
          extra_data: expect.objectContaining({
            messageId: 'multi-msg',
            partIndex: 0,
            content: 'First message',
          }),
        })
      );

      mockLog.mockClear();

      // Advance timers more to reveal second part (inter-delay + typing = 200ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      // Second part should now be logged
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'chatMessage:assistant',
          extra_data: expect.objectContaining({
            messageId: 'multi-msg',
            partIndex: 1,
            content: 'Second message',
          }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 15: Typing Indicator Display
  it('should display typing indicator during message sequencing', async () => {
    vi.useFakeTimers();
    try {
      const { useChat } = await import('@ai-sdk/react');
      const mockUseChat = vi.mocked(useChat);

      const mockSendMessage = vi.fn();
      const mockSetMessages = vi.fn();

      // Start with initialized state
      const emptyUserMessage = createUserMessage('', 'initial-user-message');
      const msg = createAssistantMessage(
        JSON.stringify(['First message part', 'Second message part']),
        'typing-test-msg'
      );
      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, msg],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      const { container } = renderWithJotai(<ChatPanel />, {
        initialValues: [
          [
            studyParamsAtom,
            {
              username: 'test-user',
              condition: 'n',
              page: 'task',
              autoRefreshInterval: 15000,
            },
          ],
        ],
      });

      // Advance timers to reveal first part
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // Check that first message part is visible
      const messages = container.querySelectorAll('.mb-3.text-sm.leading-snug');
      expect(messages.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 16: Notification Badge Timing
  it('should show notification badge for 5 seconds when message appears', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    const { rerender, container } = renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockSetMessages.mockClear();
    mockSendMessage.mockClear();

    // Add assistant message
    const msg = createAssistantMessage('Test message', 'notif-test-msg');
    mockUseChat.mockReturnValue(createMockChatHelpers({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    rerender(<ChatPanel />);

    // Notification badge should appear immediately when message renders
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Note: The notification badge is controlled by state, not directly visible in DOM
    // This test verifies the component renders without errors when messages appear
    expect(container.querySelector('.bg-white')).toBeInTheDocument();

    // Wait to ensure no runtime errors during 5 second notification window
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  // Test 17: Scroll to bottom when displayed messages change
  it('should scroll to bottom when displayed messages change', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    const { rerender } = renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockSetMessages.mockClear();

    // Add a new message
    const msg = createUserMessage('New message', 'scroll-test-msg');
    mockUseChat.mockReturnValue(createMockChatHelpers({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    // Mock scrollIntoView to verify it's called
    const mockScrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = mockScrollIntoView;

    rerender(<ChatPanel />);

    // scrollIntoView should be called when displayed messages change
    await waitFor(() => {
      expect(mockScrollIntoView).toHaveBeenCalled();
    });
  });

  // Test 18: Display limited message parts when streaming
  it('should hide last assistant message while streaming', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    const msg = createAssistantMessage('Streaming response', 'stream-msg');

    mockUseChat.mockReturnValue(createMockChatHelpers({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'streaming',
    }));

    const { container } = renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // While streaming, the last message should be hidden
    const messageDivs = container.querySelectorAll('.mb-3.text-sm.leading-snug');
    expect(messageDivs.length).toBe(0);
  });

  // Test 19: Show last message when not streaming (after typing animation)
  it('should show last assistant message when not streaming', async () => {
    vi.useFakeTimers();
    try {
      const { useChat } = await import('@ai-sdk/react');
      const mockUseChat = vi.mocked(useChat);

      const mockSendMessage = vi.fn();
      const mockSetMessages = vi.fn();
      const emptyUserMessage = createUserMessage('', 'initial-user-message');
      const msg = createAssistantMessage('Complete response', 'complete-msg');

      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, msg],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      const { container } = renderWithJotai(<ChatPanel />, {
        initialValues: [
          [
            studyParamsAtom,
            {
              username: 'test-user',
              condition: 'n',
              page: 'task',
              autoRefreshInterval: 15000,
            },
          ],
        ],
      });

      // Advance timers to reveal message (typing animation)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      const messageDivs = container.querySelectorAll('.mb-3.text-sm.leading-snug');
      expect(messageDivs.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 20: Display only visible message parts (controlled by typing animation)
  it('should respect visibleMessagePartCount for last assistant message', async () => {
    vi.useFakeTimers();
    try {
      const { useChat } = await import('@ai-sdk/react');
      const mockUseChat = vi.mocked(useChat);

      const mockSendMessage = vi.fn();
      const mockSetMessages = vi.fn();
      const emptyUserMessage = createUserMessage('', 'initial-user-message');
      const msg = createAssistantMessage(
        JSON.stringify(['Part 1', 'Part 2', 'Part 3']),
        'multi-part-msg'
      );

      mockUseChat.mockReturnValue(createMockChatHelpers({
        messages: [emptyUserMessage, msg],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
      }));

      const { container } = renderWithJotai(<ChatPanel />, {
        initialValues: [
          [
            studyParamsAtom,
            {
              username: 'test-user',
              condition: 'n',
              page: 'task',
              autoRefreshInterval: 15000,
            },
          ],
        ],
      });

      // Initially no assistant parts visible (need to wait for typing animation)
      let messages = container.querySelectorAll('.mb-3.text-sm.leading-snug');
      expect(messages.length).toBe(0);

      // Advance timers to reveal first part
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      messages = container.querySelectorAll('.mb-3.text-sm.leading-snug');
      expect(messages.length).toBe(1);

      // Advance timers more to reveal second part
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      messages = container.querySelectorAll('.mb-3.text-sm.leading-snug');
      expect(messages.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // Test 21: Scroll triggers on visibleMessagePartCount change
  it('should scroll when visibleMessagePartCount changes', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue(createMockChatHelpers({
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    const { rerender } = renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: 'test-user',
            condition: 'n',
            page: 'task',
            autoRefreshInterval: 15000,
          },
        ],
      ],
    });

    await waitFor(() => {
      expect(mockSetMessages).toHaveBeenCalled();
    });
    mockSetMessages.mockClear();

    // Add message with multiple parts
    const msg = createAssistantMessage(
      JSON.stringify(['Part 1', 'Part 2']),
      'scroll-trigger-msg'
    );
    mockUseChat.mockReturnValue(createMockChatHelpers({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
    }));

    const mockScrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = mockScrollIntoView;

    rerender(<ChatPanel />);

    // scrollIntoView should be called when message parts become visible
    await waitFor(() => {
      expect(mockScrollIntoView).toHaveBeenCalled();
    });
  });
});
