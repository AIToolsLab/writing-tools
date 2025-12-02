'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';

export default function ChatPanel() {
  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
  });

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [isInitialMessageSent, setIsInitialMessageSent] = useState(false);

  const isLoading = status === 'submitted' || status === 'streaming';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setInput('');

    await sendMessage({ text: userMessage });

    setShowNotification(true);
    setTimeout(() => setShowNotification(false), 5000);
  };

  // Parse JSON array responses from the assistant
  const parseMessageContent = (content: string): string[] => {
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
  };

  // Extract text from message parts
  const getMessageText = (message: typeof messages[0]): string => {
    return message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text: string }).text)
      .join('');
  };

  return (
    <div className="bg-white border border-gray-300 rounded flex flex-col h-80 shadow-sm">
      <div className="flex items-center gap-2.5 bg-gray-50 border-b border-gray-300 px-3 py-2.5">
        <div className="w-2 h-2 rounded-full bg-yellow-500" />
        <div className="flex-1">
          <div className="font-semibold text-sm">Sarah Martinez</div>
          <div className="text-xs text-gray-600">Events Coordinator</div>
        </div>
        <div className="text-xs text-gray-500">Busy</div>
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
                className={`px-2.5 py-2 rounded-xl ${
                  isUser
                    ? 'bg-blue-100 rounded-br-sm ml-auto'
                    : 'bg-gray-100 rounded-bl-sm'
                }`}
              >
                {part}
              </div>
              <div className="text-[10px] text-gray-400 mt-1">
                {formatTime(new Date())}
              </div>
              {isUser && (
                <div className="text-[10px] text-green-500 mt-0.5">Read</div>
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

      <form onSubmit={onSubmit} className="border-t border-gray-200 p-2 bg-gray-50 flex gap-1.5">
        <input
          type="text"
          className="flex-1 px-2.5 py-2 border border-gray-300 rounded-2xl text-sm outline-none focus:border-green-500"
          placeholder="Message Sarah..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
        />
        <button
          type="submit"
          className="px-4 py-2 bg-green-500 text-white rounded-2xl text-sm font-medium hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
          disabled={isLoading || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
