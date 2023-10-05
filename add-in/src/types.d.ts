declare module '*.css';

interface ReflectionResponseItem {
	reflection: string;
}

interface ReflectionResponses {
	reflections: ReflectionResponseItem[];
}

interface CardData {
	paragraphIndex: number;
	body: string;
}

interface ChatMessage {
	role: string;
	content: string;
}
