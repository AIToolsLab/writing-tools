import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import type { RefObject } from 'react';
import AIPanel from '@/components/AIPanel';
import type { WritingAreaRef } from '@/components/WritingArea';
import { studyParamsAtom } from '@/contexts/StudyContext';
import type { ConversationMessage, TextEditorState } from '@/types';
import type { StudyParams } from '@/types/study';
import { renderWithJotai } from '../utils/test-utils';

vi.mock('@/lib/logging', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

const INTERVAL = 15000;

const studyParams: StudyParams = {
  username: 'test-user',
  condition: 'c', // complete_document
  page: 'task',
  autoRefreshInterval: INTERVAL,
  experiment: 'type',
  isProlific: false,
  scenario: 'roomDoubleBooking',
  conversationHistory: true,
};

const editorState: TextEditorState = {
  beforeCursor: 'Dear Jaden, I am writing to let you know about ',
  selectedText: '',
  afterCursor: '',
};

const writingAreaRef: RefObject<WritingAreaRef | null> = {
  current: { getEditorState: () => editorState },
};

function conversation(length: number): ConversationMessage[] {
  return Array.from({ length }, (_, i) => ({
    role: i % 2 === 0 ? 'colleague' : 'user',
    content: `message ${i}`,
  }));
}

function renderPanel(chatConversation: ConversationMessage[]) {
  return renderWithJotai(
    <AIPanel writingAreaRef={writingAreaRef} isStudyMode chatConversation={chatConversation} />,
    { initialValues: [[studyParamsAtom, studyParams]] }
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('AIPanel - auto-refresh', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const suggestionCalls = () =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/writing-support');

  beforeEach(() => {
    vi.useFakeTimers();
    let n = 0;
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ suggestions: [`suggestion ${n++}`] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetches a suggestion once the interval elapses, and skips unchanged repeats', async () => {
    renderPanel(conversation(2));

    await advance(INTERVAL - 1);
    expect(suggestionCalls()).toHaveLength(0);

    await advance(1);
    expect(suggestionCalls()).toHaveLength(1);

    // Nothing changed, so the next tick is a duplicate and is skipped
    await advance(INTERVAL);
    expect(suggestionCalls()).toHaveLength(1);
  });

  // Regression: chat updates used to restart the interval, so chat arriving more
  // often than the interval starved auto-refresh entirely.
  it('keeps refreshing on schedule while the chat conversation changes', async () => {
    let length = 2;
    const { rerender } = renderPanel(conversation(length));

    // Chat grows at 4s, 14s, 24s, 34s, 44s; ticks are due at 15s, 30s, 45s.
    const chatUpdate = () =>
      rerender(
        <AIPanel writingAreaRef={writingAreaRef} isStudyMode chatConversation={conversation(++length)} />
      );

    await advance(4000);
    chatUpdate();
    await advance(10000); // t=14s
    chatUpdate();
    await advance(1000); // t=15s
    expect(suggestionCalls()).toHaveLength(1);

    await advance(9000); // t=24s
    chatUpdate();
    await advance(6000); // t=30s
    expect(suggestionCalls()).toHaveLength(2);

    await advance(4000); // t=34s
    chatUpdate();
    await advance(10000); // t=44s
    chatUpdate();
    await advance(1000); // t=45s
    expect(suggestionCalls()).toHaveLength(3);
  });

  it('sends the updated conversation history on the tick after a chat change', async () => {
    const { rerender } = renderPanel(conversation(2));

    await advance(INTERVAL);
    expect(suggestionCalls()).toHaveLength(1);

    rerender(<AIPanel writingAreaRef={writingAreaRef} isStudyMode chatConversation={conversation(3)} />);
    await advance(INTERVAL);

    const calls = suggestionCalls();
    expect(calls).toHaveLength(2);
    const body = JSON.parse((calls[1][1] as RequestInit).body as string);
    expect(body.conversationHistory).toEqual(conversation(3));
    expect(body.context).toBe('complete_document');
    expect(body.editorState).toEqual(editorState);
  });
});
