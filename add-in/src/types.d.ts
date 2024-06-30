declare module '*.css';

interface ChatMessage {
	role: string;
	content: string;
}

interface SavedItem {
	document: string;
	generation: string;
	type: string;
	dateSaved: Date;
}
