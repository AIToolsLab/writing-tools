// ChatPanel against the real useChat, with only the server faked (at fetch).
// ChatPanel.test.tsx mocks useChat, so it can't catch ChatPanel calling the SDK
// wrongly, e.g. passing sendMessage a `messageId`, which useChat treats as
// "edit this existing message" and throws on.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import ChatPanel from '@/components/ChatPanel';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { renderWithJotai } from '../utils/test-utils';

vi.mock('@/lib/logging', () => ({ log: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/messageTiming', () => ({
  calculateThinkingDelay: vi.fn(() => 100),
  calculateTypingDuration: vi.fn(() => 100),
  calculateInterMessageDelay: vi.fn(() => 100),
}));

// The colleague's server, faked at fetch: replies to /api/chat with `parts`,
// in the SDK's own stream format, and records what was sent.
function fakeChatServer(parts: string[]) {
  const requests: Array<{ messages: Array<{ id: string; role: string }> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)));
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: 'text-start', id: 't' });
          writer.write({ type: 'text-delta', id: 't', delta: JSON.stringify(parts) });
          writer.write({ type: 'text-end', id: 't' });
        },
      }),
    });
  }));
  return requests;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('ChatPanel with the real useChat', () => {
  it('sends a message and shows the reply', async () => {
    vi.useFakeTimers();
    const requests = fakeChatServer(['Sure thing', 'It is at 2pm']);
    renderWithJotai(<ChatPanel />, {
      initialValues: [[studyParamsAtom, { username: 'u', scenario: 'roomDoubleBooking' }]],
    });
    await act(() => vi.advanceTimersByTimeAsync(60_000)); // opening message

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'When?' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(requests).toHaveLength(1);
    expect(requests[0].messages.at(-1)).toMatchObject({ role: 'user', id: expect.stringMatching(/^user-/) });
    expect(screen.getByText('When?')).toBeTruthy();
    expect(screen.getByText('Sure thing')).toBeTruthy();
    expect(screen.getByText('It is at 2pm')).toBeTruthy();
  });
});
