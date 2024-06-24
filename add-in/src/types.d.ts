declare module '*.css';

interface ChatMessage {
	role: string;
	content: string;
}

interface HistoryItem {
    document: string;
    generations: {
        generation: string
        type: string;
        dateSaved: Date;
    }[];
}
