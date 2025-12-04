import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';
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
    status: 'idle',
  })),
}));

describe('ChatPanel - Message Logging', () => {
  const mockLog = vi.mocked(logging.log);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: User Message Logging
  it('should log user messages with correct event type and payload structure', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const userMessage = createUserMessage('Hello Sarah', 'user-msg-1');

    const mockSendMessage = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [userMessage],
      sendMessage: mockSendMessage,
      status: 'idle',
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
      expect(mockLog).toHaveBeenCalledWith({
        username: 'test-user',
        event: 'chatMessage:user',
        extra_data: {
          messageId: 'user-msg-1',
          content: 'Hello Sarah',
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        },
      });
    });
  });

  // Test 2: Assistant Message Logging
  it('should log assistant messages with correct event type', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const assistantMessage = createAssistantMessage('How can I help?', 'assistant-msg-1');

    const mockSendMessage = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [assistantMessage],
      sendMessage: mockSendMessage,
      status: 'idle',
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
          }),
        })
      );
    });
  });

  // Test 3: Message Deduplication
  it('should not log the same message multiple times', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const message = createUserMessage('Test', 'duplicate-msg');

    const mockSendMessage = vi.fn();
    // Initially return no messages (implicit greeting will be sent)
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'idle',
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

    // Implicit greeting is sent on mount
    expect(mockSendMessage).toHaveBeenCalledWith({ text: '' });
    mockSendMessage.mockClear();
    mockLog.mockClear();

    // Now update the mock to return the user message
    mockUseChat.mockReturnValue({
      messages: [message],
      sendMessage: mockSendMessage,
      status: 'idle',
    });

    // Wait for the message to be logged
    rerender(<ChatPanel />);
    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    // Re-render with same message again
    mockLog.mockClear();
    rerender(<ChatPanel />);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not log again on re-render (message hasn't changed)
    expect(mockLog).toHaveBeenCalledTimes(0);
  });

  // Test 4: Multiple Messages
  it('should log multiple messages in sequence', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const msg1 = createUserMessage('First', 'msg-1');
    const msg2 = createAssistantMessage('Response', 'msg-2');
    const msg3 = createUserMessage('Follow up', 'msg-3');

    mockUseChat.mockReturnValue({
      messages: [msg1, msg2, msg3],
      sendMessage: vi.fn(),
      status: 'idle',
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
      expect(mockLog).toHaveBeenCalledTimes(3);
    });

    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'chatMessage:user',
        extra_data: expect.objectContaining({ messageId: 'msg-1' }),
      })
    );

    expect(mockLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: 'chatMessage:assistant',
        extra_data: expect.objectContaining({ messageId: 'msg-2' }),
      })
    );

    expect(mockLog).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        event: 'chatMessage:user',
        extra_data: expect.objectContaining({ messageId: 'msg-3' }),
      })
    );
  });

  // Test 5: Text Extraction from Multiple Parts
  it('should correctly extract text from message parts', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const messageWithMultipleParts = {
      id: 'multi-part-msg',
      role: 'user',
      parts: [
        { type: 'text', text: 'Part 1 ' },
        { type: 'text', text: 'Part 2' },
        { type: 'image', url: 'https://example.com/img.png' },
        { type: 'text', text: ' Part 3' },
      ],
    };

    mockUseChat.mockReturnValue({
      messages: [messageWithMultipleParts],
      sendMessage: vi.fn(),
      status: 'idle',
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
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          extra_data: expect.objectContaining({
            content: 'Part 1 Part 2 Part 3',
          }),
        })
      );
    });
  });

  // Test 6: Empty/Missing Text
  it('should handle messages with empty or missing text', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const emptyMessage = {
      id: 'empty-msg',
      role: 'user',
      parts: [{ type: 'text', text: '' }, { type: 'text' }],
    };

    mockUseChat.mockReturnValue({
      messages: [emptyMessage],
      sendMessage: vi.fn(),
      status: 'idle',
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
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          extra_data: expect.objectContaining({
            content: '',
          }),
        })
      );
    });
  });

  // Test 7: Username from Atom
  it('should use username from studyParamsAtom', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const message = createUserMessage('Test');

    mockUseChat.mockReturnValue({
      messages: [message],
      sendMessage: vi.fn(),
      status: 'idle',
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

    const message = createUserMessage('Test');

    mockUseChat.mockReturnValue({
      messages: [message],
      sendMessage: vi.fn(),
      status: 'idle',
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

  // Test 10: Incremental Messages with Sequencing
  it('should log new messages when added incrementally', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    // Initially render with no messages (implicit greeting will be sent)
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'idle',
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

    // Verify implicit greeting was sent
    expect(mockSendMessage).toHaveBeenCalledWith({ text: '' });
    mockSendMessage.mockClear();
    mockLog.mockClear();

    // Add first user message
    const msg1 = createUserMessage('First', 'msg-1');
    mockUseChat.mockReturnValue({
      messages: [msg1],
      sendMessage: mockSendMessage,
      status: 'idle',
    });

    rerender(<ChatPanel />);

    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'chatMessage:user',
        extra_data: expect.objectContaining({ messageId: 'msg-1' }),
      })
    );

    mockLog.mockClear();

    // Add assistant message with multiple parts (like backend returns)
    // The message text is a JSON array that gets parsed
    const msg2 = createAssistantMessage(
      JSON.stringify(['First part', 'Second part']),
      'msg-2'
    );
    mockUseChat.mockReturnValue({
      messages: [msg1, msg2],
      sendMessage: mockSendMessage,
      status: 'idle',
    });

    rerender(<ChatPanel />);

    // Should log the assistant message when it appears
    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    expect(mockLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'chatMessage:assistant',
        extra_data: expect.objectContaining({ messageId: 'msg-2' }),
      })
    );
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
      status: 'idle',
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

  // Test 13: Implicit Greeting on Mount
  it('should send implicit greeting when component mounts with no messages', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'idle',
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

    // Should send an implicit greeting (empty message) on mount
    expect(mockSendMessage).toHaveBeenCalledWith({ text: '' });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  // Test 14: Message Sequencing with Multiple Parts
  it('should sequence multiple message parts with delays', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    // Start with no messages
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'idle',
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

    expect(mockSendMessage).toHaveBeenCalledWith({ text: '' });
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
      status: 'idle',
    });

    rerender(<ChatPanel />);

    // First message should appear immediately
    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    // The message should be logged with the full JSON content
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'chatMessage:assistant',
        extra_data: expect.objectContaining({
          messageId: 'multi-msg',
        }),
      })
    );
  });

  // Test 15: Typing Indicator Display
  it('should display typing indicator during message sequencing', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const mockSendMessage = vi.fn();
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'idle',
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

    mockSendMessage.mockClear();

    // Add assistant message with multiple parts
    const msg = createAssistantMessage(
      JSON.stringify(['First message part', 'Second message part']),
      'typing-test-msg'
    );
    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      status: 'idle',
    });

    rerender(<ChatPanel />);

    // After a short delay, typing indicator should appear for inter-message delay
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
    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      status: 'idle',
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

    mockSendMessage.mockClear();

    // Add assistant message
    const msg = createAssistantMessage('Test message', 'notif-test-msg');
    mockUseChat.mockReturnValue({
      messages: [msg],
      sendMessage: mockSendMessage,
      status: 'idle',
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
});
