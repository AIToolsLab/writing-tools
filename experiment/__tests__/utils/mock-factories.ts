import type { UIMessage } from '@ai-sdk/react';

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
