/// <reference types="vite/client" />

interface ImportMetaEnv {
	// Add custom environment variables here if needed
	readonly VITE_API_URL?: string;
}

interface ImportMeta {
	readonly hot?: {
		readonly data: any;
		accept(): void;
		accept(cb: (mod: any) => void): void;
		accept(dep: string, cb: (mod: any) => void): void;
		accept(deps: readonly string[], cb: (mods: any[]) => void): void;
		dispose(cb: (data: any) => void): void;
		decline(): void;
		invalidate(): void;
		on(event: string, cb: (...args: any[]) => void): void;
	};
	readonly env: ImportMetaEnv;
}
