// @vitest-environment jsdom
/**
 * The life of one Draft request: reading the document, generating, failing,
 * and being retried.
 *
 * Reading the document is the first step of the request, not a preamble to
 * it. On Google Docs it is an Apps Script round-trip, which fails on its own
 * terms — so a failed read has to reach the writer the same way a failed
 * generation does, and Retry has to start the ask over rather than replay a
 * request captured earlier.
 */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noopEditorAPI } from '@/api/__fixtures__/editorAPI';
import { EditorContext } from '@/contexts/editorContext';
import Draft from '..';

vi.mock('@/hooks/useLog', () => ({ useLog: () => vi.fn() }));
vi.mock('@/api/openai', () => ({
	languageModel: {},
	openaiProviderOptions: {},
}));
const generateFullText = vi.fn<(options: unknown) => Promise<string>>();
vi.mock('@/api/generate', () => ({
	generateFullText: (options: unknown) => generateFullText(options),
}));

function doc(text: string): DocContext {
	return { beforeCursor: text, selectedText: '', afterCursor: '' };
}

function scriptError(message: string): Error {
	return Object.assign(new Error(message), { name: 'ScriptError' });
}

/** The document text a generation call was given. */
function sentText(callIndex: number): string {
	const options = generateFullText.mock.calls[callIndex][0] as {
		messages: { content: unknown }[];
	};
	return JSON.stringify(options.messages);
}

function renderDraft(getDocContext: () => Promise<DocContext>) {
	render(
		<EditorContext.Provider value={noopEditorAPI({ getDocContext })}>
			<Draft />
		</EditorContext.Provider>,
	);
	return screen.getByRole('button', { name: 'Questions' });
}

describe('Draft request lifecycle', () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('reports a failed document read instead of losing the click', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let read = () => Promise.resolve(doc('Mount-time read.'));
		const button = renderDraft(() => read());
		await act(async () => {});

		read = () => Promise.reject(new Error('GeneralException'));
		fireEvent.click(button);

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/couldn't read your document/i);
		expect(generateFullText).not.toHaveBeenCalled();
		// The panel is usable again, not stuck mid-request.
		expect(
			screen.getByRole<HTMLButtonElement>('button', { name: 'Questions' })
				.disabled,
		).toBe(false);
	});

	it('withholds Retry when the Google Docs grant has lapsed', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let read = () => Promise.resolve(doc('Mount-time read.'));
		const button = renderDraft(() => read());
		await act(async () => {});

		read = () =>
			Promise.reject(
				scriptError(
					'Authorization is required to perform that action.',
				),
			);
		fireEvent.click(button);

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/Extensions menu/);
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
	});

	it('retries a failed read by asking again, not by replaying an older request', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let read = () => Promise.resolve(doc('First version.'));
		const button = renderDraft(() => read());
		await act(async () => {});

		// One successful request, so there *is* an older request to replay.
		generateFullText.mockResolvedValue('- A question?');
		fireEvent.click(button);
		await screen.findByText('A question?');

		// The read fails on the next ask...
		read = () => Promise.reject(scriptError('Service unavailable'));
		fireEvent.click(button);
		fireEvent.click(
			await screen.findByRole('button', { name: 'Try again' }),
		);
		// ...and Retry must not quietly re-send "First version.".
		await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
		expect(generateFullText).toHaveBeenCalledTimes(1);

		// Once the read works, Retry generates from the document as it is now.
		read = () => Promise.resolve(doc('Second version.'));
		fireEvent.click(
			await screen.findByRole('button', { name: 'Try again' }),
		);
		await waitFor(() => expect(generateFullText).toHaveBeenCalledTimes(2));
		expect(sentText(1)).toContain('Second version.');
		expect(sentText(1)).not.toContain('First version.');
	});

	it('retries a failed generation against the current document', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let read = () => Promise.resolve(doc('Before the edit.'));
		const button = renderDraft(() => read());
		await act(async () => {});

		generateFullText.mockRejectedValueOnce(
			new TypeError('Failed to fetch'),
		);
		fireEvent.click(button);
		const retry = await screen.findByRole('button', { name: 'Try again' });

		// The writer keeps writing before retrying.
		read = () => Promise.resolve(doc('After the edit.'));
		generateFullText.mockResolvedValue('- A question?');
		fireEvent.click(retry);

		await screen.findByText('A question?');
		expect(sentText(1)).toContain('After the edit.');
	});

	it('ignores a second click while the document is still being read', async () => {
		const pendingReads: ((value: DocContext) => void)[] = [];
		let read = () => Promise.resolve(doc('Mount-time read.'));
		const button = renderDraft(() => read());
		await act(async () => {});

		read = () =>
			new Promise<DocContext>((resolve) => {
				pendingReads.push(resolve);
			});
		generateFullText.mockResolvedValue('- A question?');
		// Two clicks before the slow read comes back — a double-click, or an
		// impatient writer on Google Docs.
		fireEvent.click(button);
		fireEvent.click(screen.getByRole('button', { name: 'Advice' }));

		await act(async () => {
			for (const release of pendingReads) release(doc('Slow read.'));
			await Promise.resolve();
		});
		await screen.findByText('A question?');
		expect(generateFullText).toHaveBeenCalledTimes(1);
	});
});
