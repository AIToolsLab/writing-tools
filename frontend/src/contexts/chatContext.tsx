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
	/**
	 * The document's paragraphs as the model last saw them (the first-turn
	 * snapshot, the latest `view`), which the next turn's edit note is diffed
	 * against. Null before the first turn.
	 */
	docBaseline: string[] | null;
	setDocBaseline: (paragraphs: string[] | null) => void;
}>({
	chatMessages: [],
	updateChatMessages: (_chatMessages: ModelMessage[]) => {},
	docBaseline: null,
	setDocBaseline: (_paragraphs: string[] | null) => {},
});

export default function ChatContextWrapper({ children }: PropsWithChildren) {
	const [chatMessages, updateChatMessages] = useState<ModelMessage[]>([]);
	const [docBaseline, setDocBaseline] = useState<string[] | null>(null);

	const contextValue = useMemo(
		() => ({
			chatMessages,
			updateChatMessages,
			docBaseline,
			setDocBaseline,
		}),
		[chatMessages, docBaseline],
	);

	return (
		<ChatContext.Provider value={contextValue}>
			{children}
		</ChatContext.Provider>
	);
}
