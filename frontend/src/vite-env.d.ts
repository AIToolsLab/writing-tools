/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_MINDMAP_TOOL_URL?: string;
	readonly VITE_ENABLE_MINDMAP_TOOL?: string;
	/** Workbench model server; defaults to https://llm.thoughtful-ai.com. */
	readonly VITE_ENGINE_URL?: string;
}
