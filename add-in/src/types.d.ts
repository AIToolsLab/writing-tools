declare module '*.css';

interface LLMResponseItem {
	reflection: string;
}

interface LLMResponses {
	generatedTexts: LLMResponseItem[];
}

interface CardData {
	paragraphIndex: number;
	body: string;
}

interface ChatMessage {
	role: string;
	content: string;
}
