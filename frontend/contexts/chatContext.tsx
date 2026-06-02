'use client';

import { type PropsWithChildren, createContext, useMemo, useState } from 'react';
import type { ChatMessage } from '@/lib/types';

// Stores chat messages in a context so that they are saved when a user switches between tabs
export const ChatContext = createContext<{
	chatMessages: ChatMessage[];
	updateChatMessages: (chatMessages: ChatMessage[]) => void;
}>({
	chatMessages: [],
	updateChatMessages: () => {},
});

export default function ChatContextWrapper({ children }: PropsWithChildren) {
	const [chatMessages, updateChatMessages] = useState<ChatMessage[]>([]);

	const contextValue = useMemo(
		() => ({
			chatMessages,
			updateChatMessages,
		}),
		[chatMessages],
	);

	return <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>;
}
