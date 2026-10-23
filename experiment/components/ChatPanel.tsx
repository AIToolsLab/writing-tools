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

// User messages carry the time they were sent; assistant parts get theirs from
// `revealedAt` when the typing animation shows them.
type ChatMessage = UIMessage<{ sentAt?: number }>;

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

// Marks every assistant part not yet revealed as revealed at `now`.
function withAllPartsRevealed(
  revealedAt: Map<string, Date>,
  messages: ChatMessage[],
  now: Date
): Map<string, Date> {
  let next: Map<string, Date> | null = null;
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const text = getMessageText(message);
    if (!text) continue;
    parseMessageContent(text).forEach((_, partIndex) => {
      const key = partKey(message.id, partIndex);
      if (!revealedAt.has(key)) {
        next ??= new Map(revealedAt);
        next.set(key, now);
      }
    });
  }
  return next ?? revealedAt;
}

const FOLLOWUP_DELAY_MS = 75000; // 75 seconds (between 60-90s)

interface ChatPanelProps {
  onNewMessage?: () => void;
  onMessagesChange?: (messages: UIMessage[]) => void;
}

export default function ChatPanel({ onNewMessage, onMessagesChange }: ChatPanelProps) {
  const studyParams = useAtomValue(studyParamsAtom);
  const username = studyParams.username || 'demo';
  const scenario = getScenario(studyParams.scenario);

  const { messages, sendMessage, status, setMessages } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: {
        scenario: studyParams.scenario,
      },
    }),
  });

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // When each assistant part (keyed by partKey) appeared on screen. A part is
  // displayed exactly when it has an entry here, and the entry is the time shown
  // under it, so it never drifts on re-render.
  const [revealedAt, setRevealedAt] = useState<Map<string, Date>>(new Map());
  const [showTypingIndicator, setShowTypingIndicator] = useState(false);
  const [deliveredMessageIds, setDeliveredMessageIds] = useState<Set<string>>(new Set());
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(new Set());
  const loggedMessagePartsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef(false);
  const followupSentRef = useRef(false);
  const followupTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isLoading = status === 'submitted' || status === 'streaming';

  const scrollToBottom = useEffectEvent(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  const notifyNewMessage = useEffectEvent(() => {
    if (onNewMessage) {
      onNewMessage();
    }
  });

  // Derive the messages that are actually displayed to the user
  const displayedMessages = useMemo(() => {
    return messages.map((message) => {
      const isUser = message.role === 'user';
      const messageText = getMessageText(message);
      if (!messageText) return { parts: [], isUser, messageId: message.id };

      if (isUser) {
        const sentAt = message.metadata?.sentAt;
        return {
          parts: [{ text: messageText, shownAt: sentAt === undefined ? undefined : new Date(sentAt) }],
          isUser,
          messageId: message.id,
        };
      }

      const parts = parseMessageContent(messageText).flatMap((text, partIndex) => {
        const shownAt = revealedAt.get(partKey(message.id, partIndex));
        return shownAt ? [{ text, shownAt }] : [];
      });
      return { parts, isUser, messageId: message.id };
    });
  }, [messages, revealedAt]);

  // Scroll to bottom whenever displayed messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll target position depends on displayed messages rendering.
    useEffect(() => {
    scrollToBottom();
  }, [displayedMessages]);

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

  // Notify parent of message changes (for conversation history feature)
  useEffect(() => {
    if (onMessagesChange) {
      // Filter out the initial empty user message
      const meaningful = messages.filter(
        (m) => !(m.id === 'initial-user-message' && getMessageText(m).trim() === '')
      );
      onMessagesChange(meaningful);
    }
  }, [messages, onMessagesChange]);

  // Proactive follow-up timer: if user hasn't sent a message after FOLLOWUP_DELAY_MS, colleague sends a nudge
  useEffect(() => {
    // Check if user has sent any real messages (beyond the initial empty one)
    const userHasSentMessage = messages.some(
      (m) => m.role === 'user' && m.id !== 'initial-user-message' && getMessageText(m).trim() !== ''
    );

    // If user has engaged or follow-up already sent, clear any pending timer
    if (userHasSentMessage || followupSentRef.current) {
      if (followupTimerRef.current) {
        clearTimeout(followupTimerRef.current);
        followupTimerRef.current = null;
      }
      return;
    }

    // Start the follow-up timer if not already running
    if (!followupTimerRef.current && hasInitializedRef.current) {
      followupTimerRef.current = setTimeout(() => {
        if (!followupSentRef.current) {
          followupSentRef.current = true;
          // The follow-up cancels any reveal still in progress; show what's left now
          const now = new Date();
          setRevealedAt((prev) => withAllPartsRevealed(prev, messages, now));
          // Add follow-up message from colleague
          setMessages((prev) => [
            ...prev,
            {
              id: 'followup-message',
              role: 'assistant',
              parts: [{ type: 'text', text: JSON.stringify([scenario.chat.followUpMessage]) }],
            },
          ]);
        }
      }, FOLLOWUP_DELAY_MS);
    }

    return () => {
      if (followupTimerRef.current) {
        clearTimeout(followupTimerRef.current);
        followupTimerRef.current = null;
      }
    };
  }, [messages, setMessages, scenario.chat.followUpMessage]);

  // Sequence message display with delays and typing indicators
  useEffect(() => {
    // Wait for the whole reply: a partial stream is incomplete JSON
    if (status === 'streaming') return;

    const lastMessage = messages.at(-1);
    if (lastMessage?.role !== 'assistant') return;

    const messageText = getMessageText(lastMessage);
    if (!messageText) return;
    const parsedMessages = parseMessageContent(messageText);

    const timers: NodeJS.Timeout[] = [];

    // Busy/read delay before typing indicator shows up
    const thinkingDelay = calculateThinkingDelay(parsedMessages[0].length);
    const busyLag = messages.length === 2 ? 0 : 1200; // Skip lag for first message (length 2 because of initial empty user message + assistant response)
    let currentDelay = messages.length === 2 ? 0 : thinkingDelay + busyLag;

    parsedMessages.forEach((messagePart, index) => {
      if (index > 0) {
        // Pause based on previous message length
        currentDelay += calculateInterMessageDelay(parsedMessages[index - 1].length);
      }

      // Show typing indicator, then the part once it's "typed"
      timers.push(
        setTimeout(() => {
          setShowTypingIndicator(true);
          scrollToBottom();
        }, currentDelay)
      );

      currentDelay += calculateTypingDuration(messagePart.length);

      const key = partKey(lastMessage.id, index);
      timers.push(
        setTimeout(() => {
          const now = new Date();
          setRevealedAt((prev) => (prev.has(key) ? prev : new Map(prev).set(key, now)));
          setShowTypingIndicator(false);
          notifyNewMessage();
        }, currentDelay)
      );
    });

    return () => {
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
    };
  }, [messages, status]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Track user messages for delivered/read status (uses useChat's message IDs for UI)
  const trackedUserMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const deliveredTimers: NodeJS.Timeout[] = [];
    const readTimers: NodeJS.Timeout[] = [];
    messages.forEach((message) => {
      if (message.role !== 'user' || !message.id || message.id === 'initial-user-message') return;
      if (trackedUserMessageIdsRef.current.has(message.id)) return;
      trackedUserMessageIdsRef.current.add(message.id);

      // Mark message as delivered after a short delay
      const deliveredDelay = 500 + Math.random() * 500; // 0.5-1s
      const deliveredTimer = setTimeout(() => {
        setDeliveredMessageIds((prev) => new Set(prev).add(message.id));
      }, deliveredDelay);
      deliveredTimers.push(deliveredTimer);

      // Mark message as read after a short delay to feel more human
      const readDelay = 3000 + Math.random() * 5000; // 3-8 seconds
      const readTimer = setTimeout(() => {
        setReadMessageIds((prev) => new Set(prev).add(message.id));
      }, readDelay);
      readTimers.push(readTimer);
    });

    // Cleanup the timers on unmount
    return () => {
      deliveredTimers.forEach((timer) => void clearTimeout(timer));
      readTimers.forEach((timer) => void clearTimeout(timer));
    };
  }, [messages]);

  // Log each assistant message part once, when it first becomes visible
  useEffect(() => {
    for (const displayedMessage of displayedMessages) {
      if (displayedMessage.isUser) continue;
      displayedMessage.parts.forEach((part, partIndex) => {
        const partId = partKey(displayedMessage.messageId, partIndex);
        if (loggedMessagePartsRef.current.has(partId)) return;
        loggedMessagePartsRef.current.add(partId);
        log({
          username,
          event: 'chatMessage:assistant',
          extra_data: {
            messageId: displayedMessage.messageId,
            partIndex,
            content: part.text,
            timestamp: part.shownAt?.toISOString(),
          },
        });
      });
    }
  }, [displayedMessages, username]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    const messageId = `user-${Date.now()}`;
    const now = new Date();
    setInput('');
    setShowTypingIndicator(false); // ensure no immediate typing indicator on send

    // Sending cancels any reveal still in progress; show what's left now
    setRevealedAt((prev) => withAllPartsRevealed(prev, messages, now));

    // Log the user message event immediately (event-driven, no duplicates)
    log({
      username,
      event: 'chatMessage:user',
      extra_data: {
        messageId,
        content: userMessage,
        timestamp: now.toISOString(),
      },
    });

    await sendMessage({ text: userMessage, messageId, metadata: { sentAt: now.getTime() } });
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
        {displayedMessages.map((displayedMessage) => {
          return displayedMessage.parts.map((part, partIdx) => (
            <div
              key={partKey(displayedMessage.messageId, partIdx)}
              className={`mb-3 text-sm leading-snug animate-fadeIn ${
                displayedMessage.isUser ? 'ml-auto' : ''
              }`}
              style={{ maxWidth: '85%' }}
            >
              <div
                className={`px-2.5 py-2 rounded-xl text-gray-900 ${
                  displayedMessage.isUser
                    ? 'bg-blue-200 rounded-br-sm ml-auto font-medium'
                    : 'bg-gray-200 rounded-bl-sm'
                }`}
              >
                {part.text}
              </div>
              {part.shownAt && (
                <div className="text-[10px] text-gray-600 mt-1">
                  {formatTime(part.shownAt)}
                </div>
              )}
              {displayedMessage.isUser && (
                readMessageIds.has(displayedMessage.messageId) ? (
                    <div className="text-[10px] font-semibold text-green-700 mt-0.5">Read</div>
                  ) : deliveredMessageIds.has(displayedMessage.messageId) ? (
                    <div className="text-[10px] font-semibold text-gray-600 mt-0.5">Delivered</div>
                  ) : null
              )}
            </div>
          ));
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
          type="text"
          className="flex-1 px-2.5 py-2 border border-gray-400 rounded-2xl text-sm text-gray-900 placeholder-gray-500 bg-white outline-none focus:border-green-600 focus:ring-2 focus:ring-green-200"
          placeholder={`Message ${scenario.colleague.firstName}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
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
