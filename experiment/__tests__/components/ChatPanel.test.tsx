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
    setMessages: vi.fn(),
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

    mockUseChat.mockReturnValue({
      messages: [userMessage],
      sendMessage: vi.fn(),
      status: 'idle',
      setMessages: vi.fn(),
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

    mockUseChat.mockReturnValue({
      messages: [assistantMessage],
      sendMessage: vi.fn(),
      status: 'idle',
      setMessages: vi.fn(),
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

    mockUseChat.mockReturnValue({
      messages: [message],
      sendMessage: vi.fn(),
      status: 'idle',
      setMessages: vi.fn(),
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
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    // Re-render with same message
    rerender(<ChatPanel />);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockLog).toHaveBeenCalledTimes(1);
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
      setMessages: vi.fn(),
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
      setMessages: vi.fn(),
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
      setMessages: vi.fn(),
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
      setMessages: vi.fn(),
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

  // Test 8: Default Username Fallback
  it('should fallback to "demo" when username is empty', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const message = createUserMessage('Test');

    mockUseChat.mockReturnValue({
      messages: [message],
      sendMessage: vi.fn(),
      status: 'idle',
      setMessages: vi.fn(),
    });

    renderWithJotai(<ChatPanel />, {
      initialValues: [
        [
          studyParamsAtom,
          {
            username: '',
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
          username: 'demo',
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
      setMessages: vi.fn(),
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

  // Test 10: Incremental Messages
  it('should log new messages when added incrementally', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const msg1 = createUserMessage('First', 'msg-1');

    mockUseChat.mockReturnValue({
      messages: [msg1],
      sendMessage: vi.fn(),
      status: 'idle',
      setMessages: vi.fn(),
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
      expect(mockLog).toHaveBeenCalledTimes(1);
    });

    const msg2 = createAssistantMessage('Second', 'msg-2');
    mockUseChat.mockReturnValue({
      messages: [msg1, msg2],
      sendMessage: vi.fn(),
      status: 'idle',
      setMessages: vi.fn(),
    });

    rerender(<ChatPanel />);

    await waitFor(() => {
      expect(mockLog).toHaveBeenCalledTimes(2);
    });

    expect(mockLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: 'chatMessage:assistant',
        extra_data: expect.objectContaining({ messageId: 'msg-2' }),
      })
    );
  });

  // Test 11: Messages Without IDs
  it('should not log messages without IDs', async () => {
    const { useChat } = await import('@ai-sdk/react');
    const mockUseChat = vi.mocked(useChat);

    const messageWithoutId = {
      id: '',
      role: 'user',
      parts: [{ type: 'text', text: 'Test' }],
    };

    mockUseChat.mockReturnValue({
      messages: [messageWithoutId],
      sendMessage: vi.fn(),
      status: 'idle',
      setMessages: vi.fn(),
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
      setMessages: vi.fn(),
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
});
