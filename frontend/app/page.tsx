'use client';

import dynamic from 'next/dynamic';

// The editor uses Lexical and localStorage, so render it client-only (no SSR).
const StandaloneEditor = dynamic(() => import('@/components/editor/StandaloneEditor'), {
	ssr: false,
	loading: () => <div className="p-8 text-sm text-zinc-500">Loading editor…</div>,
});

export default function Home() {
	return <StandaloneEditor />;
}
