'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { log } from '@/lib/logging';
import { calculateTypingDuration, calculateInterMessageDelay, calculateThinkingDelay } from '@/lib/messageTiming';
import { getScenario } from '@/lib/studyConfig';
import { parseMessageContent } from '@/lib/chatUtils';
import type { UIMessage } from '@ai-sdk/react';
import type { ConversationMessage } from '@/types';

// The colleague's side of the chat is a discrete-event simulation. Everything
// that happens over time — each part she types, the delivered/read receipts on
// the user's messages, the follow-up nudge — is planned as a timestamp up
// front, and the UI shows whatever is due by `now`. A single timer advances
// `now` to the next planned time.

// User messages carry the time they were sent.
type ChatMessage = UIMessage<{ sentAt?: number }>;

// When she starts typing a part, and when it appears (epoch ms)
type PartPlan = { messageId: string; typingAt: number; shownAt: number };
type PartTiming = Omit<PartPlan, 'messageId'>;
type Receipt = { deliveredAt: number; readAt: number };

// What happens to parts she hasn't finished typing when the user sends a message:
// 'flush' shows them all at once; 'keepTyping' lets her finish, and her reply
// to the new message waits until she has. Either way the colleague model gets
// the user's message after her whole reply, not where it appears on screen.
const INTERRUPT_POLICY: 'flush' | 'keepTyping' = 'keepTyping';

const FOLLOWUP_DELAY_MS = 75000; // 75 seconds (between 60-90s)

// Utility function to extract text from message parts
function getMessageText(message: { parts: Array<{ type: string; text?: string }> }): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

function partKey(messageId: string, partIndex: number): string {
  return `${messageId}-${partIndex}`;
}

// Plans her reading a reply and typing out each part, as offsets from when she
// starts reading. Random, so call it once per reply, outside state updaters.
function replyTimings(partTexts: string[], isFirstMessage: boolean): PartTiming[] {
  // Busy/read delay before typing indicator shows up. Skipped for the opening message.
  const thinkingDelay = calculateThinkingDelay(partTexts[0].length);
  const busyLag = 1200;
  let offset = isFirstMessage ? 0 : thinkingDelay + busyLag;

  return partTexts.map((partText, index) => {
    if (index > 0) {
      // Pause based on previous message length
      offset += calculateInterMessageDelay(partTexts[index - 1].length);
    }
    const typingAt = offset;
    offset += calculateTypingDuration(partText.length);
    return { typingAt, shownAt: offset };
  });
}

// Schedules a reply that arrived at `arrivedAt`. She can't start on it until
// she's done typing what's already planned for the messages in the chat.
function withReply(
  parts: Map<string, PartPlan>,
  messageId: string,
  timings: PartTiming[],
  arrivedAt: number,
  chatMessages: ChatMessage[]
): Map<string, PartPlan> {
  const inChat = new Set(chatMessages.map((m) => m.id));
  let start = arrivedAt;
  for (const plan of parts.values()) {
    if (inChat.has(plan.messageId)) start = Math.max(start, plan.shownAt);
  }
  const next = new Map(parts);
  timings.forEach((timing, partIndex) => {
    next.set(partKey(messageId, partIndex), {
      messageId,
      typingAt: start + timing.typingAt,
      shownAt: start + timing.shownAt,
    });
  });
  return next;
}

// Pulls every part still in the future forward to `now`.
function withAllPartsDue(parts: Map<string, PartPlan>, now: number): Map<string, PartPlan> {
  let next: Map<string, PartPlan> | null = null;
  for (const [key, plan] of parts) {
    if (plan.shownAt > now) {
      next ??= new Map(parts);
      next.set(key, { ...plan, typingAt: Math.min(plan.typingAt, now), shownAt: now });
    }
  }
  return next ?? parts;
}

interface ChatPanelProps {
  onNewMessage?: () => void;
  // The conversation as it appears on screen: only what has been shown, in the
  // order it appeared
  onConversationChange?: (conversation: ConversationMessage[]) => void;
}

export default function ChatPanel({ onNewMessage, onConversationChange }: ChatPanelProps) {
  const studyParams = useAtomValue(studyParamsAtom);
  const username = studyParams.username || 'demo';
  const scenario = getScenario(studyParams.scenario);

  const [now, setNow] = useState(() => Date.now());
  const [partPlans, setPartPlans] = useState<Map<string, PartPlan>>(() =>
    withReply(new Map(), 'initial-assistant-message', replyTimings(scenario.chat.initialMessages, true), Date.now(), [])
  );
  const [receipts, setReceipts] = useState<Map<string, Receipt>>(new Map());
  const [followupAt, setFollowupAt] = useState<number | null>(() => Date.now() + FOLLOWUP_DELAY_MS);

  const { messages, sendMessage, status, setMessages } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: {
        scenario: studyParams.scenario,
      },
    }),
    // useChat keeps the options from its first render, so this must only use setters
    onFinish: ({ message, messages: allMessages }) => {
      if (message.role !== 'assistant') return;
      const messageText = getMessageText(message);
      if (!messageText) return;
      const arrivedAt = Date.now();
      // length 2 = initial empty user message + assistant response
      const timings = replyTimings(parseMessageContent(messageText), allMessages.length === 2);
      setPartPlans((prev) => withReply(prev, message.id, timings, arrivedAt, allMessages));
    },
  });

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loggedMessagePartsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef(false);

  const isLoading = status === 'submitted' || status === 'streaming';

  const scrollToBottom = useEffectEvent(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  const notifyNewMessage = useEffectEvent(() => {
    if (onNewMessage) {
      onNewMessage();
    }
  });

  // Advance the clock to `eventAt` and act on anything that has come due.
  // setTimeout's delay is measured on a monotonic clock but `Date.now()` is wall
  // time, which can step (NTP, sleep/wake), so the timer for an event is what
  // vouches that the event is due.
  const tick = useEffectEvent((eventAt: number) => {
    const t = Math.max(Date.now(), eventAt);
    setNow((prev) => Math.max(prev, t));
    if (followupAt !== null && t >= followupAt) {
      setFollowupAt(null);
      setMessages((prev) => [
        ...prev,
        {
          id: 'followup-message',
          role: 'assistant',
          parts: [{ type: 'text', text: JSON.stringify([scenario.chat.followUpMessage]) }],
        },
      ]);
      const timings = replyTimings([scenario.chat.followUpMessage], false);
      setPartPlans((prev) => withReply(prev, 'followup-message', timings, t, messages));
    }
  });

  // One timer per planned event still to come. (Chaining a single timer to the
  // next event would make each one wait on a render before the next is set.)
  useEffect(() => {
    const eventTimes = new Set<number>();
    for (const plan of partPlans.values()) {
      eventTimes.add(plan.typingAt);
      eventTimes.add(plan.shownAt);
    }
    for (const receipt of receipts.values()) {
      eventTimes.add(receipt.deliveredAt);
      eventTimes.add(receipt.readAt);
    }
    if (followupAt !== null) eventTimes.add(followupAt);

    const start = Date.now();
    const timers = [...eventTimes]
      .filter((t) => t > start)
      .map((t) => setTimeout(() => tick(t), t - start));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [partPlans, receipts, followupAt]);

  // Background tabs throttle timers; catch up as soon as the participant is back
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick(0);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Keys of the parts due by `now`. A string, so it only changes when a part
  // appears, not on every tick (receipts, typing indicator).
  const revealedKeys = useMemo(
    () =>
      [...partPlans]
        .filter(([, plan]) => plan.shownAt <= now)
        .map(([key]) => key)
        .join('\n'),
    [partPlans, now]
  );

  // Every part on screen, in the order it appeared
  const displayedParts = useMemo(() => {
    const revealed = new Set(revealedKeys.split('\n'));
    const shown: Array<{ key: string; messageId: string; isUser: boolean; text: string; shownAt?: number }> = [];
    for (const message of messages) {
      const messageText = getMessageText(message);
      if (!messageText) continue;
      if (message.role === 'user') {
        shown.push({
          key: partKey(message.id, 0),
          messageId: message.id,
          isUser: true,
          text: messageText,
          shownAt: message.metadata?.sentAt,
        });
      } else if (message.role === 'assistant') {
        parseMessageContent(messageText).forEach((text, partIndex) => {
          const key = partKey(message.id, partIndex);
          const plan = partPlans.get(key);
          if (plan && revealed.has(key)) {
            shown.push({ key, messageId: message.id, isUser: false, text, shownAt: plan.shownAt });
          }
        });
      }
    }
    // Stable sort: parts that appeared together keep message order
    return shown.sort((a, b) => (a.shownAt ?? 0) - (b.shownAt ?? 0));
  }, [messages, partPlans, revealedKeys]);

  const showTypingIndicator = useMemo(() => {
    const inChat = new Set(messages.map((m) => m.id));
    return [...partPlans.values()].some(
      (plan) => inChat.has(plan.messageId) && plan.typingAt <= now && now < plan.shownAt
    );
  }, [messages, partPlans, now]);

  // Scroll to bottom whenever displayed messages or the typing indicator change
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll target position depends on displayed messages rendering.
    useEffect(() => {
    scrollToBottom();
  }, [displayedParts, showTypingIndicator]);

  // Initialize conversation on mount
  useEffect(() => {
    if (!hasInitializedRef.current && messages.length === 0) {
      hasInitializedRef.current = true;
      setMessages([
        {
          id: 'initial-user-message',
          role: 'user',
          parts: [{ type: 'text', text: '' }],
        },
        {
          id: 'initial-assistant-message',
          role: 'assistant',
          parts: [{ type: 'text', text: JSON.stringify(scenario.chat.initialMessages) }],
        }
      ]);
    }
  }, [messages.length, setMessages, scenario.chat.initialMessages]);

  // Notify parent of what's on screen (for conversation history feature)
  useEffect(() => {
    onConversationChange?.(
      displayedParts.map((part) => ({ role: part.isUser ? 'user' : 'colleague', content: part.text }))
    );
  }, [displayedParts, onConversationChange]);

  // Log each assistant message part once, when it first becomes visible
  useEffect(() => {
    let anyNew = false;
    for (const part of displayedParts) {
      if (part.isUser || loggedMessagePartsRef.current.has(part.key)) continue;
      loggedMessagePartsRef.current.add(part.key);
      anyNew = true;
      log({
        username,
        event: 'chatMessage:assistant',
        extra_data: {
          messageId: part.messageId,
          partIndex: Number(part.key.slice(part.messageId.length + 1)),
          content: part.text,
          timestamp: new Date().toISOString(),
          plannedAt: part.shownAt === undefined ? undefined : new Date(part.shownAt).toISOString(),
        },
      });
    }
    if (anyNew) notifyNewMessage();
  }, [displayedParts, username]);

  const formatTime = (t: number) => {
    return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    const messageId = `user-${Date.now()}`;
    const sentAt = Date.now();
    setInput('');
    inputRef.current?.focus();
    setNow((prev) => Math.max(prev, sentAt));
    setFollowupAt(null);
    if (INTERRUPT_POLICY === 'flush') {
      setPartPlans((prev) => withAllPartsDue(prev, sentAt));
    }
    setReceipts((prev) =>
      new Map(prev).set(messageId, {
        deliveredAt: sentAt + 500 + Math.random() * 500, // 0.5-1s
        readAt: sentAt + 3000 + Math.random() * 5000, // 3-8 seconds, to feel more human
      })
    );

    // Log the user message event immediately (event-driven, no duplicates)
    log({
      username,
      event: 'chatMessage:user',
      extra_data: {
        messageId,
        content: userMessage,
        timestamp: new Date(sentAt).toISOString(),
      },
    });

    // Pass the id on the message itself: sendMessage's `messageId` option means
    // "replace the user message with this id", and throws if there isn't one.
    await sendMessage({ id: messageId, role: 'user', parts: [{ type: 'text', text: userMessage }], metadata: { sentAt } });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2.5 bg-gray-50 border-b border-gray-300 px-3 py-2.5">
        <div className="w-2 h-2 rounded-full bg-yellow-500" />
        <div className="flex-1">
          <div className="font-semibold text-sm text-gray-900">{scenario.colleague.name}</div>
          <div className="text-xs text-gray-600">{scenario.colleague.role}</div>
        </div>
        <div className="text-xs font-medium text-gray-700">Busy</div>

      </div>

      <div className="flex-1 p-2.5 overflow-y-auto bg-white">
        {displayedParts.map((part) => {
          const receipt = part.isUser ? receipts.get(part.messageId) : undefined;
          return (
            <div
              key={part.key}
              className={`mb-3 text-sm leading-snug animate-fadeIn ${
                part.isUser ? 'ml-auto' : ''
              }`}
              style={{ maxWidth: '85%' }}
            >
              <div
                className={`px-2.5 py-2 rounded-xl text-gray-900 ${
                  part.isUser
                    ? 'bg-blue-200 rounded-br-sm ml-auto font-medium'
                    : 'bg-gray-200 rounded-bl-sm'
                }`}
              >
                {part.text}
              </div>
              {part.shownAt !== undefined && (
                <div className="text-[10px] text-gray-600 mt-1">
                  {formatTime(part.shownAt)}
                </div>
              )}
              {receipt && (
                receipt.readAt <= now ? (
                    <div className="text-[10px] font-semibold text-green-700 mt-0.5">Read</div>
                  ) : receipt.deliveredAt <= now ? (
                    <div className="text-[10px] font-semibold text-gray-600 mt-0.5">Delivered</div>
                  ) : null
              )}
            </div>
          );
        })}

        {showTypingIndicator && (
          <div className="flex items-center gap-1 px-3 py-2 bg-gray-100 rounded-xl w-fit mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0s' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.4s' }} />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={onSubmit} className="border-t border-gray-300 p-2 bg-gray-50 flex gap-1.5">
        <input
          ref={inputRef}
          type="text"
          className="flex-1 px-2.5 py-2 border border-gray-400 rounded-2xl text-sm text-gray-900 placeholder-gray-500 bg-white outline-none focus:border-green-600 focus:ring-2 focus:ring-green-200"
          placeholder={`Message ${scenario.colleague.firstName}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="submit"
          className="px-4 py-2 bg-green-600 text-white rounded-2xl text-sm font-semibold hover:bg-green-700 active:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          disabled={isLoading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
