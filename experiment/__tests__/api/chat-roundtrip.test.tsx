/**
 * Fake OpenAI → real chat route → real `useChat`, with nothing mocked between.
 *
 * The route's server side (`ai`, `@ai-sdk/openai`) and the client (`@ai-sdk/react`)
 * talk over the SDK's own stream protocol, and both sides change together in an
 * upgrade. This is the test that fails if they drift apart, or if the provider
 * stops parsing OpenAI's stream the way it used to. (`ChatPanel.test.tsx` mocks
 * `useChat`, so it can't catch either.)
 *
 * The transport is configured like ChatPanel's, but its `fetch` calls the route
 * handler directly instead of going over the network.
 */
import { useChat } from '@ai-sdk/react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/chat/route';
import {
  readFixture,
  sseResponse,
  streamedText,
  stubOpenAI,
} from '../utils/openai-fixtures';

function textOf(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function renderChat() {
  return renderHook(() =>
    useChat({
      transport: new DefaultChatTransport({
        api: '/api/chat',
        body: { scenario: 'roomDoubleBooking' },
        fetch: (_input, init) =>
          POST(new Request('http://localhost/api/chat', init)),
      }),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('chat round trip', () => {
  it('delivers the streamed reply to useChat as one assistant message', async () => {
    const fixture = readFixture('chat-stream.sse');
    stubOpenAI(() => sseResponse(fixture));
    const { result } = renderChat();

    await act(() => result.current.sendMessage({ text: 'What time?' }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBeUndefined();
    const [user, assistant] = result.current.messages;
    expect(user.role).toBe('user');
    expect(textOf(user)).toBe('What time?');
    expect(assistant.role).toBe('assistant');
    expect(textOf(assistant)).toBe(streamedText(fixture));
    expect(textOf(assistant)).not.toBe('');
    expect(result.current.messages).toHaveLength(2);
  });

  it('surfaces a mid-stream provider error instead of an empty reply', async () => {
    // OpenAI reports quota exhaustion as an `error` event after a 200 — the
    // case that showed up as a blank panel in the add-in frontend.
    stubOpenAI(() =>
      sseResponse(readFixture('chat-stream-quota-error.sse')),
    );
    const { result } = renderChat();

    await act(() => result.current.sendMessage({ text: 'What time?' }));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBeDefined();
    const assistantText = result.current.messages
      .filter((m) => m.role === 'assistant')
      .map(textOf)
      .join('');
    expect(assistantText).toBe('');
  });
});
