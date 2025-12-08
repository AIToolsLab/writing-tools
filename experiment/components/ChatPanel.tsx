'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { log } from '@/lib/logging';
import { calculateTypingDuration, calculateInterMessageDelay } from '@/lib/messageTiming';

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

const INITIAL_MESSAGES = [
  "Hey, remember that panel we're coordinating with Jaden tomorrow?",
  "Turns out we double-booked the room! 😬 Sophia has already announced to her fans that her panel will be in room 12 at 1pm. And she's the more famous influencer, so we can't back out on her.",
  "Need you to send him an email sorting this out."
];

export default function ChatPanel() {
  const studyParams = useAtomValue(studyParamsAtom);
  const username = studyParams.username || 'demo';

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
  });

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [visibleMessagePartCount, setVisibleMessagePartCount] = useState(0);
  const [showTypingIndicator, setShowTypingIndicator] = useState(false);
  const lastLoggedMessageIdRef = useRef<string>('');
  const loggedMessagePartsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef(false);

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
          parts: [{ type: 'text', text: JSON.stringify(INITIAL_MESSAGES) }],
        }
      ]);
    }
  }, [messages.length, setMessages]);

  // Sequence message display with delays and typing indicators
  useEffect(() => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;

    const messageText = getMessageText(lastMessage);
    const parsedMessages = parseMessageContent(messageText);

    if (parsedMessages.length === 0) return;

    // Show all parts if single message or first part of multi-message response
    setTimeout(() => setVisibleMessagePartCount(1), 0);

    // For multiple messages (array response), add typing indicator and delay between them
    if (parsedMessages.length > 1) {
      let currentDelay = 0;
      const timers: NodeJS.Timeout[] = [];

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
        }
      });

      return () => {
        timers.forEach((timer) => {
          clearTimeout(timer);
        });
      };
    }
  }, [messages]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Track and log new messages
  useEffect(() => {
    messages.forEach((message, messageIndex) => {
      if (!message.id) return;

      const isLastMessage = messageIndex === messages.length - 1;

      if (message.role === 'user') {
        // Log user messages normally
        if (message.id !== lastLoggedMessageIdRef.current) {
          const messageText = getMessageText(message);
          log({
            username,
            event: 'chatMessage:user',
            extra_data: {
              messageId: message.id,
              content: messageText,
              timestamp: new Date().toISOString(),
            },
          });
          lastLoggedMessageIdRef.current = message.id;
        }
      } else if (message.role === 'assistant') {
        const messageText = getMessageText(message);
        const parsedMessages = parseMessageContent(messageText);

        if (isLastMessage) {
          // For last message, only log visible parts
          for (let i = 0; i < visibleMessagePartCount; i++) {
            const partId = `${message.id}-${i}`;
            if (!loggedMessagePartsRef.current.has(partId)) {
              log({
                username,
                event: 'chatMessage:assistant',
                extra_data: {
                  messageId: message.id,
                  partIndex: i,
                  content: parsedMessages[i],
                  timestamp: new Date().toISOString(),
                },
              });
              loggedMessagePartsRef.current.add(partId);
            }
          }
        } else {
          // For non-last messages, log all parts
          parsedMessages.forEach((part, partIndex) => {
            const partId = `${message.id}-${partIndex}`;
            if (!loggedMessagePartsRef.current.has(partId)) {
              log({
                username,
                event: 'chatMessage:assistant',
                extra_data: {
                  messageId: message.id,
                  partIndex,
                  content: part,
                  timestamp: new Date().toISOString(),
                },
              });
              loggedMessagePartsRef.current.add(partId);
            }
          });
        }
      }
    });
  }, [messages, visibleMessagePartCount, username]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setInput('');

    await sendMessage({ text: userMessage });

    // Reset message part count for next response
    setVisibleMessagePartCount(0);
  };

  // Show notification when a new assistant message part appears
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant' && visibleMessagePartCount > 0) {
      const showTimer = setTimeout(() => setShowNotification(true), 0);
      const hideTimer = setTimeout(() => setShowNotification(false), 5000);
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
  }, [messages, visibleMessagePartCount]);

  return (
    <div className="h-full bg-white border border-gray-300 rounded flex flex-col overflow-hidden shadow-sm">
      <div className="flex items-center gap-2.5 bg-gray-50 border-b border-gray-300 px-3 py-2.5">
        <div className="w-2 h-2 rounded-full bg-yellow-500" />
        <div className="flex-1">
          <div className="font-semibold text-sm text-gray-900">Sarah Martinez</div>
          <div className="text-xs text-gray-600">Events Coordinator</div>
        </div>
        <div className="text-xs font-medium text-gray-700">Busy</div>
        {showNotification && (
          <span className="bg-red-500 text-white rounded-full px-1.5 py-0.5 text-xs font-bold">
            1
          </span>
        )}
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
                <div className="text-[10px] font-semibold text-green-700 mt-0.5">Read</div>
              )}
            </div>
          ));
        })}

        {(isLoading || showTypingIndicator) && (
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
          placeholder="Message Sarah..."
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
