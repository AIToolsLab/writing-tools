'use client';

import type { UIMessage } from 'ai';
import { type PropsWithChildren, createContext, useMemo, useState } from 'react';

// Persists chat messages across tab switches (the Chat panel unmounts when another tab is
// active, so its useChat state would otherwise be lost).
export const ChatContext = createContext<{
	chatMessages: UIMessage[];
	updateChatMessages: (chatMessages: UIMessage[]) => void;
}>({
	chatMessages: [],
	updateChatMessages: () => {},
});

export default function ChatContextWrapper({ children }: PropsWithChildren) {
	const [chatMessages, updateChatMessages] = useState<UIMessage[]>([]);

	const contextValue = useMemo(
		() => ({
			chatMessages,
			updateChatMessages,
		}),
		[chatMessages],
	);

	return <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>;
}
