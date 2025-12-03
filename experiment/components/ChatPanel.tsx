'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { log } from '@/lib/logging';

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
  const [isInitialMessageSent, setIsInitialMessageSent] = useState(false);
  const lastLoggedMessageIdRef = useRef<string>('');

  const isLoading = status === 'submitted' || status === 'streaming';

  const scrollToBottom = useEffectEvent(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize with the first message
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: '1',
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: "Hey, remember that panel we're coordinating with Jaden tomorrow?",
            },
          ],
        },
      ]);
    }
  }, [messages.length, setMessages]);

  // Send the second message after delay
  useEffect(() => {
    if (!isInitialMessageSent && messages.length === 1) {
      const timer = setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            id: '2',
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: "Turns out we double-booked the room! 😬 Sophia has already announced to her fans that her panel will be in room 12 at 1pm. And she's the more famous influencer, so we can't back out on her.",
              },
            ],
          },
        ]);
        setIsInitialMessageSent(true);
        setShowNotification(true);
        setTimeout(() => setShowNotification(false), 5000);
      }, 8000);

      return () => clearTimeout(timer);
    }
  }, [isInitialMessageSent, messages.length, setMessages]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Track and log new messages
  useEffect(() => {
    messages.forEach((message) => {
      if (message.id && message.id !== lastLoggedMessageIdRef.current) {
        const messageText = getMessageText(message);

        if (message.role === 'assistant') {
          // Log assistant messages
          log({
            username,
            event: 'chatMessage:assistant',
            extra_data: {
              messageId: message.id,
              content: messageText,
              timestamp: new Date().toISOString(),
            },
          });
        } else if (message.role === 'user') {
          // Log user messages
          log({
            username,
            event: 'chatMessage:user',
            extra_data: {
              messageId: message.id,
              content: messageText,
              timestamp: new Date().toISOString(),
            },
          });
        }

        lastLoggedMessageIdRef.current = message.id;
      }
    });
  }, [messages, username]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setInput('');

    await sendMessage({ text: userMessage });

    setShowNotification(true);
    setTimeout(() => setShowNotification(false), 5000);
  };

  return (
    <div className="bg-white border border-gray-300 rounded flex flex-col overflow-hidden shadow-sm">
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
        {messages.map((message) => {
          const isUser = message.role === 'user';
          const messageText = getMessageText(message);
          const messageParts = isUser ? [messageText] : parseMessageContent(messageText);

          return messageParts.map((part, partIdx) => (
            <div
              key={`${message.id}-${partIdx}`}
              className={`mb-3 text-sm leading-snug animate-fadeIn ${
                isUser ? 'ml-auto' : ''
              }`}
              style={{ maxWidth: '85%' }}
            >
              <div
                className={`px-2.5 py-2 rounded-xl text-gray-900 ${
                  isUser
                    ? 'bg-blue-200 rounded-br-sm ml-auto font-medium'
                    : 'bg-gray-200 rounded-bl-sm'
                }`}
              >
                {part}
              </div>
              <div className="text-[10px] text-gray-600 mt-1">
                {formatTime(new Date())}
              </div>
              {isUser && (
                <div className="text-[10px] font-semibold text-green-700 mt-0.5">Read</div>
              )}
            </div>
          ));
        })}

        {isLoading && (
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
