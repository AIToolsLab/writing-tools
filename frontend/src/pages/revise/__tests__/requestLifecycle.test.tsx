// @vitest-environment jsdom
/**
 * The life of a Revise run: reading the document, streaming each feature's
 * card, failing, and being retried.
 *
 * Each feature starts by reading the document (an Apps Script round-trip on
 * Google Docs). When that read used to reject outside the request's
 * try/finally, the run's chain stopped and "Running N features…" spun forever
 * with the Run button disabled. And because starting a request cancels the one
 * in flight, a Retry clicked mid-run stranded the running feature's card
 * half-written, with no error and no way to re-run it.
 */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { noopEditorAPI } from '@/api/__fixtures__/editorAPI';
import { describeGenerationError, GenerationError } from '@/api/errors';
import { EditorContext } from '@/contexts/editorContext';
import Revise from '..';

vi.mock('@/hooks/useLog', () => ({ useLog: () => vi.fn() }));
vi.mock('@/api/openai', () => ({
	languageModel: {},
	openaiProviderOptions: {},
}));

/** Each call to `streamTextDeltas` gets the next scripted stream. */
type Script = (signal: AbortSignal) => AsyncGenerator<string, void, void>;
const scripts: Script[] = [];
const streamTextDeltas = vi.fn((options: { abortSignal: AbortSignal }) => {
	const script = scripts.shift();
	if (!script) throw new Error('No scripted stream left');
	return script(options.abortSignal);
});
vi.mock('@/api/generate', () => ({
	streamTextDeltas: (options: { abortSignal: AbortSignal }) =>
		streamTextDeltas(options),
}));

const DOC: DocContext = {
	beforeCursor: 'A paragraph to think about.',
	selectedText: '',
	afterCursor: '',
};

/** A stream that says `text` and ends. */
function says(text: string): Script {
	return async function* () {
		await Promise.resolve();
		yield text;
	};
}

/** A stream that fails before saying anything. */
function fails(): Script {
	// eslint-disable-next-line require-yield
	return async function* () {
		await Promise.resolve();
		throw new TypeError('Failed to fetch');
	};
}

/** A stream held open until `release()`, honouring aborts meanwhile. */
function held() {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const script: Script = async function* (signal) {
		yield 'Partial answer';
		await Promise.race([
			gate,
			new Promise<void>((_, reject) =>
				signal.addEventListener('abort', () =>
					reject(new DOMException('Aborted', 'AbortError')),
				),
			),
		]);
		yield ' and the rest.';
	};
	return { script, release };
}

function renderRevise(getDocContext: () => Promise<DocContext>) {
	render(
		<EditorContext.Provider value={noopEditorAPI({ getDocContext })}>
			<Revise />
		</EditorContext.Provider>,
	);
}

function select(...keywords: string[]) {
	for (const keyword of keywords) {
		fireEvent.click(screen.getByRole('button', { name: keyword }));
	}
}

function runButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: /^Run / });
}

describe('Revise request lifecycle', () => {
	beforeAll(() => {
		// jsdom has no scrollIntoView; nothing here depends on scrolling.
		Element.prototype.scrollIntoView = vi.fn();
	});

	afterEach(() => {
		cleanup();
		scripts.length = 0;
		vi.clearAllMocks();
	});

	it('says the document could not be read, not that it is empty', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		renderRevise(() => Promise.reject(new Error('GeneralException')));

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/couldn't read your document/i);
		expect(screen.queryByText(/seems to be empty/i)).toBeNull();
	});

	it('ends the run when a read fails, with one card saying so', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		let read = () => Promise.resolve(DOC);
		renderRevise(() => read());
		await screen.findByRole('button', { name: 'Main Point' });

		select('Main Point', 'Counterarguments');
		read = () => Promise.reject(new Error('GeneralException'));
		fireEvent.click(runButton());

		await waitFor(() =>
			expect(
				screen.getAllByText(/couldn't read your document/i),
			).toHaveLength(1),
		);
		// Not stuck: the banner is gone and Run works again.
		expect(screen.queryByText(/^Running /)).toBeNull();
		expect(runButton().disabled).toBe(false);
		expect(streamTextDeltas).not.toHaveBeenCalled();
	});

	it('stops a run at a failure retrying cannot clear', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		renderRevise(() => Promise.resolve(DOC));
		await screen.findByRole('button', { name: 'Main Point' });

		// Out of credit: every remaining feature would fail identically.
		scripts.push(
			// eslint-disable-next-line require-yield
			async function* () {
				await Promise.resolve();
				// What streamTextDeltas throws for a mid-stream provider error.
				const chunk = {
					type: 'error',
					error: { code: 'insufficient_quota' },
				};
				throw new GenerationError(
					describeGenerationError(chunk),
					chunk,
				);
			},
			says('Never reached.'),
		);
		select('Main Point', 'Counterarguments');
		fireEvent.click(runButton());

		await screen.findByText('Main Point failed');
		await waitFor(() => expect(runButton().disabled).toBe(false));
		expect(streamTextDeltas).toHaveBeenCalledTimes(1);
		expect(screen.queryByText('Counterarguments failed')).toBeNull();
	});

	it('holds Retry back while a feature is still streaming', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		renderRevise(() => Promise.resolve(DOC));
		await screen.findByRole('button', { name: 'Main Point' });

		const second = held();
		scripts.push(fails(), second.script);
		select('Main Point', 'Counterarguments');
		fireEvent.click(runButton());

		// The first feature has failed; the second is mid-stream.
		await screen.findByText('Partial answer');
		expect(screen.getByText('Main Point failed')).toBeTruthy();
		// A Retry here would cancel the second feature and strand its card.
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

		await act(async () => {
			second.release();
			await Promise.resolve();
		});
		await screen.findByText('Partial answer and the rest.');

		// Once nothing is running, the failed feature can be retried.
		scripts.push(says('A main point.'));
		fireEvent.click(
			await screen.findByRole('button', { name: 'Try again' }),
		);
		await screen.findByText('A main point.');
		expect(screen.queryByText('Main Point failed')).toBeNull();
	});
});
