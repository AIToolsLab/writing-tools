import { type PropsWithChildren, createContext, useState, useMemo } from 'react';

// Stores chat messages in a context so that they are saved when a user switches between tabs
export const ChatContext = createContext<{
	chatMessages: ChatMessage[];
	updateChatMessages: (chatMessages: ChatMessage[]) => void;
}>({
	chatMessages: [],
	updateChatMessages: (_chatMessages: ChatMessage[]) => {},
});

export default function ChatContextWrapper({
	children,
}: PropsWithChildren) {
	const [chatMessages, updateChatMessages] = useState<ChatMessage[]>([]);

	const contextValue = useMemo(() => ({
		chatMessages,
		updateChatMessages
	}), [chatMessages]);

	return (
		<ChatContext.Provider value={contextValue}>
			{children}
		</ChatContext.Provider>
	);
}
