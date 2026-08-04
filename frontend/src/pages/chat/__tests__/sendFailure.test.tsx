// @vitest-environment jsdom
/**
 * What the chat does when the *document read* fails, as opposed to the model.
 *
 * On Google Docs every send begins with an Apps Script round-trip, and a sidebar
 * left open long enough loses its authorization — so the read starts rejecting
 * partway through a session that was working. It used to run outside the
 * try/finally, which left `isSendingMessage` true forever: the writer got a
 * permanently disabled input box, an unchanged transcript, and nothing on screen
 * saying why.
 */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChatContext } from '@/contexts/chatContext';
import {
	DocBriefContext,
	type DocBriefContextValue,
	EMPTY_DOC_BRIEF,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import Chat from '..';

vi.mock('@/hooks/useLog', () => ({ useLog: () => vi.fn() }));
// The model is never reached in these tests; the point is the step before it.
vi.mock('@/api/openai', () => ({
	languageModel: {},
	openaiProviderOptions: {},
}));
const streamTextDeltas = vi.fn();
vi.mock('@/api/generate', () => ({
	streamTextDeltas: (...args: unknown[]) => {
		streamTextDeltas(...args);
		// An empty stream, so a call that slips through ends rather than throwing
		// something the page would report as a model failure.
		return (async function* () {})();
	},
}));

const DOC: DocContext = {
	beforeCursor: 'My draft so far.',
	selectedText: '',
	afterCursor: '',
};

/** The rejection `google.script.run` produces once the grant has lapsed. */
function authorizationLapsed(): Error {
	return Object.assign(
		new Error('Authorization is required to perform that action.'),
		{ name: 'ScriptError' },
	);
}

/**
 * A document bridge that starts healthy and lapses when the test says so —
 * the shape of the real session, which reads the document fine for hours and
 * then stops. Nothing here depends on *how many* reads the page makes.
 */
function lapsingBridge() {
	let lapsed = false;
	return {
		lapse: () => {
			lapsed = true;
		},
		getDocContext: () =>
			lapsed
				? Promise.reject(authorizationLapsed())
				: Promise.resolve(DOC),
	};
}

function renderChat(getDocContext: () => Promise<DocContext>) {
	const editorAPI = { getDocContext } as unknown as EditorAPI;
	const brief: DocBriefContextValue = {
		brief: EMPTY_DOC_BRIEF,
		setField: vi.fn(),
		status: 'ready',
	};

	function Harness() {
		// Real chat state, so a rolled-back turn is observable.
		const [chatMessages, updateChatMessages] = useState<ChatMessage[]>([]);
		const chat = useMemo(
			() => ({ chatMessages, updateChatMessages }),
			[chatMessages],
		);
		return (
			<EditorContext.Provider value={editorAPI}>
				<DocBriefContext.Provider value={brief}>
					<ChatContext.Provider value={chat}>
						<Chat />
					</ChatContext.Provider>
				</DocBriefContext.Provider>
			</EditorContext.Provider>
		);
	}

	render(<Harness />);
	return screen.getByPlaceholderText<HTMLTextAreaElement>(
		/Ask something about your document/,
	);
}

async function send(input: HTMLTextAreaElement, text: string) {
	fireEvent.change(input, { target: { value: text } });
	const form = input.closest('form');
	if (!form) throw new Error('chat input is not in a form');
	fireEvent.submit(form);
	await waitFor(() => {
		expect(screen.queryByRole('alert')).not.toBeNull();
	});
}

/** Opens the chat on a healthy bridge, then lapses it, as a real session does. */
async function openThenLapse() {
	const bridge = lapsingBridge();
	const input = renderChat(bridge.getDocContext);
	// Let the mount-time reads settle, so the chat is seeded and quiet before
	// anything fails — the failure under test belongs to the send.
	await act(async () => {});
	expect(screen.queryByRole('alert')).toBeNull();
	bridge.lapse();
	return input;
}

describe('Chat, when the document cannot be read', () => {
	beforeAll(() => {
		// jsdom does no layout, so the transcript's auto-scroll has nothing to
		// call. It is irrelevant to what these tests assert.
		Element.prototype.scrollTo = vi.fn();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('re-enables the input and says what happened, rather than hanging disabled', async () => {
		const input = await openThenLapse();

		await send(input, 'What is my argument?');

		expect(screen.getByRole('alert').textContent).toMatch(
			/open it again from the Extensions menu/i,
		);
		// The regression: this stayed true for the life of the page.
		expect(input.disabled).toBe(false);
		expect(streamTextDeltas).not.toHaveBeenCalled();
	});

	it('keeps the writer’s text instead of clearing it into a turn that never happened', async () => {
		const input = await openThenLapse();

		await send(input, 'What is my argument?');

		expect(input.value).toBe('What is my argument?');
		// Nothing was appended, so the transcript is still the welcome screen.
		expect(
			screen.getByText('What do you think about your document so far?'),
		).toBeTruthy();
	});
});
