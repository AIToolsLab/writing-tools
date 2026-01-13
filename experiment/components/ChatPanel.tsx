'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { log } from '@/lib/logging';
import { calculateTypingDuration, calculateInterMessageDelay, calculateThinkingDelay } from '@/lib/messageTiming';
import { getScenario } from '@/lib/studyConfig';

// Utility function to extract text from message parts
function getMessageText(message: { parts: Array<{ type: string; text?: string }> }): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

// Utility function to parse JSON array responses from the assistant
function parseMessageContent(content: string): string[] {
  try {
    // Remove markdown code blocks if present
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [content];
  } catch {
    return [content];
  }
}

const FOLLOWUP_DELAY_MS = 75000; // 75 seconds (between 60-90s)

interface ChatPanelProps {
  onNewMessage?: () => void;
}

export default function ChatPanel({ onNewMessage }: ChatPanelProps) {
  const studyParams = useAtomValue(studyParamsAtom);
  const username = studyParams.username || 'demo';
  const scenario = getScenario(studyParams.scenario);

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: {
        scenario: studyParams.scenario,
      },
    }),
  });

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [visibleMessagePartCount, setVisibleMessagePartCount] = useState(0);
  const [showTypingIndicator, setShowTypingIndicator] = useState(false);
  const [deliveredMessageIds, setDeliveredMessageIds] = useState<Set<string>>(new Set());
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(new Set());
  const deliveredTimersRef = useRef<NodeJS.Timeout[]>([]);
  const readTimersRef = useRef<NodeJS.Timeout[]>([]);
  const loggedMessagePartsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef(false);
  const followupSentRef = useRef(false);
  const followupTimerRef = useRef<NodeJS.Timeout | null>(null);

  const isLoading = status === 'submitted' || status === 'streaming';

  const scrollToBottom = useEffectEvent(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  // Derive the messages that are actually displayed to the user
  const displayedMessages = useMemo(() => {
    return messages.map((message, messageIdx) => {
      const isUser = message.role === 'user';
      const messageText = getMessageText(message);
      if (!messageText) return { parts: [], isUser, messageId: message.id };

      const messageParts = isUser ? [messageText] : parseMessageContent(messageText);
      const isLastMessage = messageIdx === messages.length - 1;

      // For assistant messages, limit visible parts if it's the last message
      let partsToShow = messageParts;
      if (!isUser && isLastMessage) {
        // Hide last message while streaming to avoid showing partial JSON
        if (status === 'streaming') {
          partsToShow = [];
        } else if (visibleMessagePartCount > 0) {
          partsToShow = messageParts.slice(0, visibleMessagePartCount);
        } else {
          partsToShow = [];
        }
      }

      return { parts: partsToShow, isUser, messageId: message.id };
    });
  }, [messages, visibleMessagePartCount, status]);

  // Scroll to bottom whenever displayed messages change
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
          // Add follow-up message from colleague
          setMessages((prev) => [
            ...prev,
            {
              id: 'followup-message',
              role: 'assistant',
              parts: [{ type: 'text', text: JSON.stringify([scenario.chat.followUpMessage]) }],
            },
          ]);
          // Reset visible count so it goes through the typing animation
          setVisibleMessagePartCount(0);
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
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;

    const messageText = getMessageText(lastMessage);
    const parsedMessages = parseMessageContent(messageText);

    if (parsedMessages.length === 0) return;

    const timers: NodeJS.Timeout[] = [];

    // Busy/read delay before typing indicator shows up
    const thinkingDelay = calculateThinkingDelay(parsedMessages[0].length);
    const busyLag = messages.length === 2 ? 0 : 1200; // Skip lag for first message (length 2 because of initial empty user message + assistant response)
    const readingDelay = messages.length === 2 ? 0 : thinkingDelay + busyLag;

    const firstTypingDuration = calculateTypingDuration(parsedMessages[0].length);

    // Start typing indicator after she has “read” the message
    timers.push(
      setTimeout(() => {
        setShowTypingIndicator(true);
      }, readingDelay)
    );

    // Reveal first part after typing duration
    timers.push(
      setTimeout(() => {
        setVisibleMessagePartCount(1);
        setShowTypingIndicator(false);
      }, readingDelay + firstTypingDuration)
    );

    // For multiple messages (array response), add typing indicator and delay between them
    if (parsedMessages.length > 1) {
      let currentDelay = readingDelay + firstTypingDuration;

      parsedMessages.forEach((messagePart, index) => {
        if (index > 0) {
          // Calculate delay based on previous message length
          const previousMessageLength = parsedMessages[index - 1].length;
          const interDelay = calculateInterMessageDelay(previousMessageLength);
          currentDelay += interDelay;

          // Calculate typing duration for this message
          const typingDuration = calculateTypingDuration(messagePart.length);

          // Show typing indicator for the delay duration
          timers.push(
            setTimeout(() => {
              setShowTypingIndicator(true);
            }, currentDelay)
          );

          // Show next part and hide typing indicator
          timers.push(
            setTimeout(() => {
              setVisibleMessagePartCount((prev) => prev + 1);
              setShowTypingIndicator(false);
            }, currentDelay + typingDuration)
          );

          currentDelay += typingDuration;
        }
      });
    }

    return () => {
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
    };
  }, [messages]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Track user messages for delivered/read status (uses useChat's message IDs for UI)
  const trackedUserMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messages.forEach((message) => {
      if (message.role !== 'user' || !message.id || message.id === 'initial-user-message') return;
      if (trackedUserMessageIdsRef.current.has(message.id)) return;
      trackedUserMessageIdsRef.current.add(message.id);

      // Mark message as delivered after a short delay
      const deliveredDelay = 500 + Math.random() * 500; // 0.5-1s
      const deliveredTimer = setTimeout(() => {
        setDeliveredMessageIds((prev) => new Set(prev).add(message.id));
      }, deliveredDelay);
      deliveredTimersRef.current.push(deliveredTimer);

      // Mark message as read after a short delay to feel more human
      const readDelay = 3000 + Math.random() * 5000; // 3-8 seconds
      const readTimer = setTimeout(() => {
        setReadMessageIds((prev) => new Set(prev).add(message.id));
      }, readDelay);
      readTimersRef.current.push(readTimer);
    });
  }, [messages]);

  // Log assistant message part event - called when a new part becomes visible
  const logAssistantMessagePart = useEffectEvent((messageId: string, partIndex: number, content: string) => {
    const partId = `${messageId}-${partIndex}`;
    if (!loggedMessagePartsRef.current.has(partId)) {
      log({
        username,
        event: 'chatMessage:assistant',
        extra_data: {
          messageId,
          partIndex,
          content,
          timestamp: new Date().toISOString(),
        },
      });
      loggedMessagePartsRef.current.add(partId);
    }
  });

  // Track assistant message parts becoming visible and log them
  useEffect(() => {
    if (messages.length === 0) return;

    messages.forEach((message, messageIndex) => {
      if (message.role !== 'assistant' || !message.id) return;

      const messageText = getMessageText(message);
      const parsedMessages = parseMessageContent(messageText);
      const isLastMessage = messageIndex === messages.length - 1;

      if (isLastMessage) {
        // For last message, only log visible parts
        for (let i = 0; i < visibleMessagePartCount; i++) {
          logAssistantMessagePart(message.id, i, parsedMessages[i]);
        }
      } else {
        // For non-last messages, log all parts
        parsedMessages.forEach((part, partIndex) => {
          logAssistantMessagePart(message.id, partIndex, part);
        });
      }
    });
  }, [messages, visibleMessagePartCount]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    const messageId = `user-${Date.now()}`;
    setInput('');
    setShowTypingIndicator(false); // ensure no immediate typing indicator on send

    // Log the user message event immediately (event-driven, no duplicates)
    log({
      username,
      event: 'chatMessage:user',
      extra_data: {
        messageId,
        content: userMessage,
        timestamp: new Date().toISOString(),
      },
    });

    await sendMessage({ text: userMessage });

    // Reset message part count for next response
    setVisibleMessagePartCount(0);
  };

  const notifyNewMessage = useEffectEvent(() => {
    if (onNewMessage) {
      onNewMessage();
    }
  });

  /* Removed internal notification state as requested */

  // Show notification when a new assistant message part appears
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant' && visibleMessagePartCount > 0) {
      notifyNewMessage();
    }
  }, [messages, visibleMessagePartCount]);

  // Cleanup any pending read timers on unmount
  useEffect(() => {
    return () => {
      deliveredTimersRef.current.forEach((timer) => clearTimeout(timer));
      readTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

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
              key={`${displayedMessage.messageId}-${partIdx}`}
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
                {part}
              </div>
              <div className="text-[10px] text-gray-600 mt-1">
                {formatTime(new Date())}
              </div>
              {displayedMessage.isUser && (
                <>
                  {readMessageIds.has(displayedMessage.messageId) ? (
                    <div className="text-[10px] font-semibold text-green-700 mt-0.5">Read</div>
                  ) : deliveredMessageIds.has(displayedMessage.messageId) ? (
                    <div className="text-[10px] font-semibold text-gray-600 mt-0.5">Delivered</div>
                  ) : null}
                </>
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
