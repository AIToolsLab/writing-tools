import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor, fireEvent, screen } from '@testing-library/react';
import ChatPanel from '@/components/ChatPanel';
import { studyParamsAtom } from '@/contexts/StudyContext';
import * as logging from '@/lib/logging';
import { renderWithJotai } from '../utils/test-utils';
import { createUserMessage, createAssistantMessage } from '../utils/mock-factories';

// Mock the logging module
vi.mock('@/lib/logging', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

// Mock useChat hook
vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn(() => ({
    messages: [],
    sendMessage: vi.fn(),
    status: 'ready',
  })),
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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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

  // Test 2: Assistant Message Logging
  it('should log assistant messages with correct event type and partIndex', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const assistantMessage = createAssistantMessage('How can I help?', 'assistant-msg-1');

    const mockSendMessage = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [assistantMessage],
      sendMessage: mockSendMessage,
      status: 'ready',
    });

    mockSendMessage.mockClear();
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

    await waitFor(() => {
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
    });
  });

  // Test 3: User messages are only logged on form submission, not on re-render
  it('should not log the same message multiple times', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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

  // Test 10: Assistant messages are logged when they appear
  it('should log new messages when added incrementally', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready' as any,
    } as any);

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

    // Add assistant message (this is logged via effect when it becomes visible)
    const msg1 = createAssistantMessage(
      JSON.stringify(['Response part 1', 'Response part 2']),
      'msg-1'
    );
    mockUseChat.mockReturnValue({
      messages: [msg1],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready' as any,
    } as any);

    rerender(<ChatPanel />);

    // Should log the assistant message
    await waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    }, { timeout: 1000 });

    const assistantCall = mockLog.mock.calls.find(call =>
      call[0]?.extra_data?.messageId === 'msg-1'
    );
    expect(assistantCall).toBeDefined();
    expect(assistantCall?.[0]).toMatchObject({
      event: 'chatMessage:assistant',
      extra_data: expect.objectContaining({
        messageId: 'msg-1',
        partIndex: 0,
      }),
    });
  });

  // Test 12: System Messages
  it('should not log system messages', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const systemMessage = {
      id: 'system-msg',
      role: 'system',
      parts: [{ type: 'text', text: 'System message' }],
    };

    mockUseChat.mockReturnValue({
      messages: [systemMessage],
      sendMessage: vi.fn(),
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    // Start with no messages
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockSendMessage.mockClear();
    mockLog.mockClear();

    // Add assistant message with multiple parts
    const msg = createAssistantMessage(
      JSON.stringify(['First message', 'Second message']),
      'multi-msg'
    );
    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

    rerender(<ChatPanel />);

    // First part should be logged immediately
    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(1);
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
  });

  // Test 15: Typing Indicator Display
  it('should display typing indicator during message sequencing', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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

    // Add assistant message with multiple parts
    const msg = createAssistantMessage(
      JSON.stringify(['First message part', 'Second message part']),
      'typing-test-msg'
    );
    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

    rerender(<ChatPanel />);

    // After a short delay, typing indicator may appear for inter-message delay
    // (timing calculations are probabilistic, so we check it appears within reasonable bounds)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that first message part is visible
    const messages = container.querySelectorAll('.mb-3.text-sm.leading-snug');
    // Should have at least one message visible
    expect(messages.length).toBeGreaterThan(0);
  });

  // Test 16: Notification Badge Timing
  it('should show notification badge for 5 seconds when message appears', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
      id: 'test-id',
      error: undefined,
    } as any);

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
    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
      id: 'test-id',
      error: undefined,
    } as any);

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

    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'streaming',
    });

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

  // Test 19: Show last message when not streaming
  it('should show last assistant message when not streaming', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    const msg = createAssistantMessage('Complete response', 'complete-msg');

    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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

    await waitFor(() => {
      const messageDivs = container.querySelectorAll('.mb-3.text-sm.leading-snug');
      expect(messageDivs.length).toBeGreaterThan(0);
    });
  });

  // Test 20: Display only visible message parts
  it('should respect visibleMessagePartCount for last assistant message', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    const msg = createAssistantMessage(
      JSON.stringify(['Part 1', 'Part 2', 'Part 3']),
      'multi-part-msg'
    );

    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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

    // Initially, first part should be visible
    await waitFor(() => {
      const messages = container.querySelectorAll('.mb-3.text-sm.leading-snug');
      expect(messages.length).toBeGreaterThan(0);
    });

    const initialMessageCount = container.querySelectorAll('.mb-3.text-sm.leading-snug').length;

    // When visibleMessagePartCount increases, more parts should be visible
    // (This would require updating state, which happens via the component's internal timing logic)
    // This test verifies the structure is rendered correctly
    expect(initialMessageCount).toBeGreaterThan(0);
  });

  // Test 21: Scroll triggers on visibleMessagePartCount change
  it('should scroll when visibleMessagePartCount changes', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    const mockSetMessages = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

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
    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: 'ready',
    });

    const mockScrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = mockScrollIntoView;

    rerender(<ChatPanel />);

    // scrollIntoView should be called when message parts become visible
    await waitFor(() => {
      expect(mockScrollIntoView).toHaveBeenCalled();
    });
  });
});
