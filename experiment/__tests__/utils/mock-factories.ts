import type { UIMessage, UseChatHelpers } from '@ai-sdk/react';
import { vi } from 'vitest';

type MockChatHelpers = Partial<UseChatHelpers<UIMessage>>;

export function createMockChatHelpers(overrides: MockChatHelpers = {}) {
  return {
    id: 'test-chat',
    messages: [] as UIMessage[],
    sendMessage: vi.fn(),
    setMessages: vi.fn(),
    status: 'ready' as const,
    error: undefined,
    ...overrides,
  } as unknown as UseChatHelpers<UIMessage>;
}

export function createMockMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: Math.random().toString(36).substring(7),
    role: 'user',
    parts: [{ type: 'text', text: 'Test message' }],
    ...overrides,
  };
}

export function createUserMessage(text: string, id?: string): UIMessage {
  return createMockMessage({
    id: id || Math.random().toString(36).substring(7),
    role: 'user',
    parts: [{ type: 'text', text }],
  });
}

export function createAssistantMessage(text: string, id?: string): UIMessage {
  return createMockMessage({
    id: id || Math.random().toString(36).substring(7),
    role: 'assistant',
    parts: [{ type: 'text', text }],
  });
}
