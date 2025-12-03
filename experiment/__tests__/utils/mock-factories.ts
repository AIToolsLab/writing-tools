import { Message } from '@ai-sdk/react';

export function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: Math.random().toString(36).substring(7),
    role: 'user',
    parts: [{ type: 'text', text: 'Test message' }],
    ...overrides,
  };
}

export function createUserMessage(text: string, id?: string): Message {
  return createMockMessage({
    id: id || Math.random().toString(36).substring(7),
    role: 'user',
    parts: [{ type: 'text', text }],
  });
}

export function createAssistantMessage(text: string, id?: string): Message {
  return createMockMessage({
    id: id || Math.random().toString(36).substring(7),
    role: 'assistant',
    parts: [{ type: 'text', text }],
  });
}
