import type { ModelMessage } from 'ai';
import {
	type Dispatch,
	type PropsWithChildren,
	type SetStateAction,
	createContext,
	useMemo,
	useState,
} from 'react';

import type { UndoSplice } from '@/docTools/undo';

/**
 * What Chat tracks about the document across a conversation. Read and written
 * from inside tool calls mid-stream, so it's a mutable object rather than
 * React state (which those closures would see stale).
 */
export interface ChatDocState {
	/**
	 * The paragraphs as the model last saw them (the first-turn snapshot, the
	 * latest `view`, the document right after an applied edit): what the next
	 * turn's edit note is diffed against. Null before the first turn.
	 */
	baseline: string[] | null;
	/**
	 * Every paragraph the model has seen this conversation. They were the
	 * writer's words, so edits may reinstate them even after they're deleted.
	 */
	seen: Set<string>;
}

/** Record that the model has seen the document as `paragraphs`. */
export function recordSeen(state: ChatDocState, paragraphs: string[]): void {
	state.baseline = paragraphs;
	for (const p of paragraphs) if (p.trim() !== '') state.seen.add(p);
}

/** An applied edit's undo, by the tool call that made it. */
export interface AppliedEdit {
	undo: UndoSplice[];
	undone: boolean;
}

// Stores the chat transcript in a context so that it survives switching tabs.
// It's the model's own history (tool calls included); see pages/chat/transcript.ts.
export const ChatContext = createContext<{
	chatMessages: ModelMessage[];
	updateChatMessages: (chatMessages: ModelMessage[]) => void;
	docState: ChatDocState;
	appliedEdits: Record<string, AppliedEdit>;
	setAppliedEdits: Dispatch<SetStateAction<Record<string, AppliedEdit>>>;
}>({
	chatMessages: [],
	updateChatMessages: (_chatMessages: ModelMessage[]) => {},
	docState: { baseline: null, seen: new Set() },
	appliedEdits: {},
	setAppliedEdits: () => {},
});

export default function ChatContextWrapper({ children }: PropsWithChildren) {
	const [chatMessages, updateChatMessages] = useState<ModelMessage[]>([]);
	// One object for the provider's lifetime, mutated in place (see ChatDocState).
	const [docState] = useState<ChatDocState>(() => ({
		baseline: null,
		seen: new Set(),
	}));
	const [appliedEdits, setAppliedEdits] = useState<
		Record<string, AppliedEdit>
	>({});

	const contextValue = useMemo(
		() => ({
			chatMessages,
			updateChatMessages,
			docState,
			appliedEdits,
			setAppliedEdits,
		}),
		[chatMessages, docState, appliedEdits],
	);

	return (
		<ChatContext.Provider value={contextValue}>
			{children}
		</ChatContext.Provider>
	);
}
