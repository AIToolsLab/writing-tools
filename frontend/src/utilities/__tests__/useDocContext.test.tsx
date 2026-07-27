// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocContext } from '..';

/** A deferred promise, so a test can hold the first pull open. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const emptyContext: DocContext = {
	beforeCursor: '',
	selectedText: '',
	afterCursor: '',
};

function makeEditorAPI(getDocContext: () => Promise<DocContext>): EditorAPI {
	return {
		addSelectionChangeHandler: () => {},
		removeSelectionChangeHandler: () => {},
		getDocContext,
		selectPhrase: () => Promise.resolve(),
	};
}

describe('useDocContext', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reports loading until the first pull settles', async () => {
		const first = deferred<DocContext>();
		const { result } = renderHook(() =>
			useDocContext(makeEditorAPI(() => first.promise)),
		);

		// The initial context is empty, but that is not yet a claim about the
		// document — a page must be able to tell "not read yet" from "empty".
		expect(result.current.isLoading).toBe(true);
		expect(result.current.docContext).toEqual(emptyContext);

		await act(async () => {
			first.resolve({
				beforeCursor: 'Hello ',
				selectedText: 'world',
				afterCursor: '!',
			});
			await first.promise;
		});

		expect(result.current.isLoading).toBe(false);
		expect(result.current.docContext.selectedText).toBe('world');
	});

	it('stops loading even when the first pull fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const first = deferred<DocContext>();
		const { result } = renderHook(() =>
			useDocContext(makeEditorAPI(() => first.promise)),
		);

		expect(result.current.isLoading).toBe(true);

		await act(async () => {
			first.reject(new Error('Apps Script unavailable'));
			await first.promise.catch(() => {});
		});

		// A stuck spinner would be a worse version of the bug it replaces.
		await waitFor(() => expect(result.current.isLoading).toBe(false));
	});

	it('does not go back to loading on a later refresh', async () => {
		let pull = deferred<DocContext>();
		const { result } = renderHook(() =>
			useDocContext(makeEditorAPI(() => pull.promise)),
		);

		await act(async () => {
			pull.resolve(emptyContext);
			await pull.promise;
		});
		expect(result.current.isLoading).toBe(false);

		// Pages refresh at request time (running a feature, sending a message).
		// That must not make the page look like it is reloading from scratch.
		pull = deferred<DocContext>();
		let refreshed: Promise<DocContext>;
		act(() => {
			refreshed = result.current.refresh();
		});
		expect(result.current.isLoading).toBe(false);

		await act(async () => {
			pull.resolve({
				beforeCursor: 'Later text',
				selectedText: '',
				afterCursor: '',
			});
			await refreshed;
		});

		expect(result.current.isLoading).toBe(false);
		expect(result.current.docContext.beforeCursor).toBe('Later text');
	});

	it('resolves refresh with the fresh context', async () => {
		const context: DocContext = {
			beforeCursor: 'a',
			selectedText: 'b',
			afterCursor: 'c',
		};
		const { result } = renderHook(() =>
			useDocContext(makeEditorAPI(() => Promise.resolve(context))),
		);

		await waitFor(() => expect(result.current.isLoading).toBe(false));

		await act(async () => {
			await expect(result.current.refresh()).resolves.toEqual(context);
		});
	});
});
