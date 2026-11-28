// @vitest-environment jsdom
/**
 * What Chat does when the *document read* fails, as opposed to the model.
 *
 * Every send starts by reading the document. On Google Docs that is an Apps
 * Script round-trip, and a sidebar left open long enough loses its grant, so
 * reads start rejecting partway through a session that was working — and keep
 * rejecting until the sidebar is reopened. Retry cannot help with that, so it
 * must not be offered; the writer's text must survive either way.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { noopEditorAPI } from '@/api/__fixtures__/editorAPI';
import ChatContextWrapper from '@/contexts/chatContext';
import { EditorContext } from '@/contexts/editorContext';
import Chat from '..';

vi.mock('@/hooks/useLog', () => ({ useLog: () => vi.fn() }));
vi.mock('@/api/openai', () => ({
	languageModel: {},
	openaiProviderOptions: {},
}));
const streamParts = vi.fn();
vi.mock('@/api/generate', () => ({
	streamParts: (...args: unknown[]) => {
		streamParts(...args);
		return (async function* () {})();
	},
}));

function renderChat(getDocContext: () => Promise<DocContext>) {
	render(
		<EditorContext.Provider value={noopEditorAPI({ getDocContext })}>
			<ChatContextWrapper>
				<Chat />
			</ChatContextWrapper>
		</EditorContext.Provider>,
	);
	return screen.getByPlaceholderText<HTMLTextAreaElement>(
		/Ask something about your document/,
	);
}

async function send(input: HTMLTextAreaElement, text: string) {
	fireEvent.change(input, { target: { value: text } });
	const form = input.closest('form');
	if (!form) throw new Error('chat input is not in a form');
	fireEvent.submit(form);
	return screen.findByRole('alert');
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

	it('names the reopen step and offers no Retry once the grant has lapsed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const input = renderChat(() =>
			Promise.reject(
				Object.assign(
					new Error(
						'Authorization is required to perform that action.',
					),
					{ name: 'ScriptError' },
				),
			),
		);

		const alert = await send(input, 'What is my argument?');

		expect(alert.textContent).toMatch(/Extensions menu/);
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
		// Not stuck, and the writer's text is still theirs.
		expect(input.disabled).toBe(false);
		expect(input.value).toBe('What is my argument?');
		expect(streamParts).not.toHaveBeenCalled();
	});

	it('offers Retry for a read failure that retrying can clear', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const input = renderChat(() =>
			Promise.reject(new Error('GeneralException')),
		);

		const alert = await send(input, 'What is my argument?');

		expect(alert.textContent).toMatch(/couldn't read your document/i);
		expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
	});
});
