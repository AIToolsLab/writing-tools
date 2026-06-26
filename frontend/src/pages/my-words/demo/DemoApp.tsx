/**
 * Self-playing demo of a My Words interaction model, for side-by-side video.
 *
 * It mounts the *real* InteractionPanel + strategy against an in-memory editor
 * and a scripted responder, then plays a canned writer script. Pick the model
 * with `?strategy=walkthrough` (default) or `?strategy=propose`. The root
 * carries `data-demo-state` ("playing" → "done") so a recorder knows when to
 * stop.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildCorpus } from '../corpus';
import { InteractionPanel } from '../InteractionPanel';
import { useInteraction } from '../interaction/useInteraction';
import { MockEditor } from './mockEditor';
import { createScriptedResponder } from './scriptedResponder';
import { SCENARIOS, type StrategyKey } from './scenarios';

function strategyFromUrl(): StrategyKey {
	const p = new URLSearchParams(window.location.search).get('strategy');
	return p === 'propose' ? 'propose' : 'walkthrough';
}

function DocumentView({ editor }: { editor: MockEditor }) {
	const [snap, setSnap] = useState(() => editor.snapshot());
	useEffect(() => editor.subscribe(() => setSnap(editor.snapshot())), [editor]);

	const renderParagraph = (text: string, key: number) => {
		const sel = snap.selection;
		if (sel && text.includes(sel)) {
			const at = text.indexOf(sel);
			return (
				<p key={key} style={pStyle}>
					{text.slice(0, at)}
					<mark style={{ background: '#fde68a' }}>{sel}</mark>
					{text.slice(at + sel.length)}
				</p>
			);
		}
		return (
			<p key={key} style={pStyle}>
				{text}
			</p>
		);
	};

	return (
		<div style={docStyle}>
			<div style={docLabel}>Document</div>
			{snap.paragraphs.map(renderParagraph)}
		</div>
	);
}

export default function DemoApp() {
	const key = useMemo(strategyFromUrl, []);
	const scenario = SCENARIOS[key];

	const editor = useMemo(() => new MockEditor(scenario.doc), [scenario]);
	const responder = useMemo(
		() => createScriptedResponder(scenario.modelScript),
		[scenario],
	);
	const strategy = useMemo(() => scenario.strategy(), [scenario]);

	// Sent messages are appended to the scratchpad (the writer's word bank).
	const [scratchpad, setScratchpad] = useState(scenario.scratchpad);
	const scratchpadRef = useRef(scratchpad);
	scratchpadRef.current = scratchpad;

	const corpus = useCallback(
		async () =>
			buildCorpus({
				docText: await editor.getDocText(),
				scratchpad: scratchpadRef.current,
			}),
		[editor],
	);

	const { caption, awaiting, pending, isThinking, submit } = useInteraction({
		editor,
		strategy,
		responder,
		corpus,
		initialCaption: 'Ready when you are.',
	});

	const [done, setDone] = useState(false);

	// Play the writer script once, awaiting each turn before the next beat.
	useEffect(() => {
		let cancelled = false;
		const sleep = (ms: number) =>
			new Promise<void>((r) => setTimeout(r, ms));
		(async () => {
			for (const act of scenario.writerScript) {
				await sleep(act.delayMs ?? 1200);
				if (cancelled) return;
				if (act.input.type === 'message') {
					const line = act.display ?? act.input.text;
					const next = scratchpadRef.current
						? `${scratchpadRef.current}\n${line}`
						: line;
					scratchpadRef.current = next;
					setScratchpad(next);
				}
				await submit(act.input);
			}
			await sleep(1200);
			if (!cancelled) setDone(true);
		})();
		return () => {
			cancelled = true;
		};
		// submit is stable; run exactly once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<div
			data-demo-state={done ? 'done' : 'playing'}
			data-strategy={key}
			style={rootStyle}
		>
			<div style={headerStyle}>{scenario.title}</div>
			<div style={splitStyle}>
				<DocumentView editor={editor} />
				<div style={panelWrap}>
					<InteractionPanel
						caption={caption}
						isThinking={isThinking}
						awaiting={awaiting}
						pending={pending}
						scratchpad={scratchpad}
						onScratchpadChange={() => {}}
						input=""
						onInputChange={() => {}}
						onSend={() => {}}
						onContinue={() => {}}
						onAccept={() => {}}
						onReject={() => {}}
						disabled
					/>
				</div>
			</div>
		</div>
	);
}

const rootStyle: React.CSSProperties = {
	height: '100vh',
	display: 'flex',
	flexDirection: 'column',
	fontFamily: 'system-ui, Arial, sans-serif',
	background: '#f8fafc',
};
const headerStyle: React.CSSProperties = {
	padding: '0.6rem 1rem',
	fontSize: '0.95rem',
	fontWeight: 600,
	color: '#0f172a',
	borderBottom: '1px solid #e2e8f0',
	background: '#fff',
};
const splitStyle: React.CSSProperties = {
	flex: '1 1 auto',
	display: 'grid',
	gridTemplateColumns: '1fr 380px',
	minHeight: 0,
};
const docStyle: React.CSSProperties = {
	padding: '1.5rem 2rem',
	overflowY: 'auto',
	borderRight: '1px solid #e2e8f0',
};
const docLabel: React.CSSProperties = {
	fontSize: '0.72rem',
	fontWeight: 600,
	textTransform: 'uppercase',
	letterSpacing: '0.04em',
	color: '#94a3b8',
	marginBottom: '0.75rem',
};
const pStyle: React.CSSProperties = {
	fontSize: '1.05rem',
	lineHeight: 1.7,
	color: '#1e293b',
	margin: '0 0 1rem',
};
const panelWrap: React.CSSProperties = {
	borderLeft: '1px solid #e2e8f0',
	background: '#fff',
	minHeight: 0,
};
