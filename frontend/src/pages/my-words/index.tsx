import { useCallback, useContext, useRef, useState } from 'react';

import { OPENAI_MODEL, openai } from '@/api/openai';
import { EditorContext } from '@/contexts/editorContext';

import { buildCorpus } from './corpus';
import { InteractionPanel } from './InteractionPanel';
import { createLiveResponder, MODE_PROMPTS } from './interaction/liveResponder';
import { createProposeStrategy } from './interaction/strategies/propose';
import { createWalkthroughStrategy } from './interaction/strategies/walkthrough';
import type { InteractionStrategy } from './interaction/types';
import { useInteraction } from './interaction/useInteraction';

type StrategyKey = keyof typeof MODE_PROMPTS;

const STRATEGIES: Record<StrategyKey, () => InteractionStrategy> = {
	walkthrough: createWalkthroughStrategy,
	propose: createProposeStrategy,
};

const TAB_LABELS: Record<StrategyKey, string> = {
	walkthrough: 'Walkthrough',
	propose: 'Propose',
};

export default function MyWords() {
	const editor = useContext(EditorContext);
	const [strategyKey, setStrategyKey] = useState<StrategyKey>('walkthrough');
	// The writer's scratchpad persists across a strategy switch; the session
	// (conversation + caption) resets, via the keyed <LiveSession> below.
	const [scratchpad, setScratchpad] = useState('');

	return (
		<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
			<div
				style={{
					display: 'flex',
					gap: '0.4rem',
					padding: '0.5rem 0.75rem 0',
				}}
			>
				{(Object.keys(STRATEGIES) as StrategyKey[]).map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => setStrategyKey(key)}
						style={{
							flex: '1 1 auto',
							padding: '0.35rem',
							border: '1px solid #d1d5db',
							borderRadius: 6,
							background:
								key === strategyKey ? '#4f46e5' : '#f3f4f6',
							color: key === strategyKey ? '#fff' : '#374151',
							fontSize: '0.8rem',
							cursor: 'pointer',
						}}
					>
						{TAB_LABELS[key]}
					</button>
				))}
			</div>
			<div style={{ flex: '1 1 auto', minHeight: 0 }}>
				<LiveSession
					key={strategyKey}
					strategyKey={strategyKey}
					editor={editor}
					scratchpad={scratchpad}
					onScratchpadChange={setScratchpad}
				/>
			</div>
		</div>
	);
}

function LiveSession(props: {
	strategyKey: StrategyKey;
	editor: EditorAPI;
	scratchpad: string;
	onScratchpadChange: (v: string) => void;
}) {
	const { strategyKey, editor, scratchpad, onScratchpadChange } = props;
	const [sentMessages, setSentMessages] = useState<string[]>([]);
	const [input, setInput] = useState('');

	// Latest values for the corpus builder and scratchpad-delta note.
	const scratchpadRef = useRef(scratchpad);
	scratchpadRef.current = scratchpad;
	const messagesRef = useRef(sentMessages);
	messagesRef.current = sentMessages;
	const lastSentScratchpad = useRef('');

	const corpus = useCallback(
		async () =>
			buildCorpus({
				docText: await editor.getDocText(),
				scratchpad: scratchpadRef.current,
				userMessages: messagesRef.current,
			}),
		[editor],
	);

	// One strategy + responder per session. Recreated when the keyed component
	// remounts on a strategy switch.
	const sessionRef = useRef<{
		strategy: InteractionStrategy;
		responder: ReturnType<typeof createLiveResponder>;
	}>();
	if (!sessionRef.current) {
		sessionRef.current = {
			strategy: STRATEGIES[strategyKey](),
			responder: createLiveResponder({
				model: openai.chat(OPENAI_MODEL),
				modePrompt: MODE_PROMPTS[strategyKey],
			}),
		};
	}

	const { caption, awaiting, pending, isThinking, submit } = useInteraction({
		editor,
		strategy: sessionRef.current.strategy,
		responder: sessionRef.current.responder,
		corpus,
	});

	const onSend = useCallback(() => {
		const text = input.trim();
		if (!text) return;
		// Surface the scratchpad to the model as text when it has changed —
		// `view` is document-only now, so this is how its words reach the model.
		const scratch = scratchpadRef.current.trim();
		const note =
			scratch && scratch !== lastSentScratchpad.current
				? `(My scratchpad now reads:\n${scratch}\n)\n\n`
				: '';
		lastSentScratchpad.current = scratch;
		setSentMessages((prev) => [...prev, text]);
		setInput('');
		void submit({ type: 'message', text: `${note}${text}` });
	}, [input, submit]);

	return (
		<InteractionPanel
			caption={caption}
			isThinking={isThinking}
			awaiting={awaiting}
			pending={pending}
			scratchpad={scratchpad}
			onScratchpadChange={onScratchpadChange}
			sentMessages={sentMessages}
			input={input}
			onInputChange={setInput}
			onSend={onSend}
			onContinue={() => void submit({ type: 'continue' })}
			onAccept={() => void submit({ type: 'accept' })}
			onReject={() => void submit({ type: 'reject' })}
		/>
	);
}
