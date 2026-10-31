import type { ModelMessage } from 'ai';
import {
	type PropsWithChildren,
	createContext,
	useState,
	useMemo,
} from 'react';

// Stores the chat transcript in a context so that it survives switching tabs.
// It's the model's own history (tool calls included); see pages/chat/transcript.ts.
export const ChatContext = createContext<{
	chatMessages: ModelMessage[];
	updateChatMessages: (chatMessages: ModelMessage[]) => void;
}>({
	chatMessages: [],
	updateChatMessages: (_chatMessages: ModelMessage[]) => {},
});

export default function ChatContextWrapper({ children }: PropsWithChildren) {
	const [chatMessages, updateChatMessages] = useState<ModelMessage[]>([]);

	const contextValue = useMemo(
		() => ({
			chatMessages,
			updateChatMessages,
		}),
		[chatMessages],
	);

	return (
		<ChatContext.Provider value={contextValue}>
			{children}
		</ChatContext.Provider>
	);
}
