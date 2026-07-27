import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { googleDocsEditorAPI } from '../googleDocsEditorAPI';

/**
 * These tests pin down the Google Docs polling contract: we only re-fetch the
 * document (an expensive Apps Script round-trip) while a handler is registered
 * AND the sidebar is actually in front of the user. When the user is editing
 * the document (sidebar blurred) or the tab is hidden, polling pauses.
 *
 * We stub minimal `window`/`document` globals rather than pulling in jsdom, to
 * match the repo's node-based unit suite.
 */

const CONTEXT_A: DocContext = {
	beforeCursor: 'a',
	selectedText: '',
	afterCursor: 'b',
};
const CONTEXT_B: DocContext = {
	beforeCursor: 'a',
	selectedText: 'selected',
	afterCursor: 'b',
};

/** A tiny addEventListener/removeEventListener/emit target. */
function makeEmitter() {
	const listeners = new Map<string, Set<() => void>>();
	return {
		addEventListener(type: string, cb: () => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)?.add(cb);
		},
		removeEventListener(type: string, cb: () => void) {
			listeners.get(type)?.delete(cb);
		},
		emit(type: string) {
			for (const cb of [...(listeners.get(type) ?? [])]) cb();
		},
	};
}

let getDocContextMock: ReturnType<typeof vi.fn>;
let fakeWindow: ReturnType<typeof makeEmitter> & Record<string, unknown>;
let fakeDocument: ReturnType<typeof makeEmitter> & Record<string, unknown>;
let visible: boolean;
let focused: boolean;
// Track handlers so we can always tear down the module-level singleton state,
// even if an assertion throws mid-test.
const registered: Array<() => void> = [];

function setSidebar(nextVisible: boolean, nextFocused: boolean) {
	visible = nextVisible;
	focused = nextFocused;
}

function register(handler: () => void) {
	registered.push(handler);
	googleDocsEditorAPI.addSelectionChangeHandler(handler);
}

beforeEach(() => {
	vi.useFakeTimers();
	visible = true;
	focused = true;
	getDocContextMock = vi.fn().mockResolvedValue(CONTEXT_A);

	fakeWindow = Object.assign(makeEmitter(), {
		GoogleAppsScript: { getDocContext: getDocContextMock },
	});
	fakeDocument = Object.assign(makeEmitter(), {
		hasFocus: () => focused,
	});
	Object.defineProperty(fakeDocument, 'visibilityState', {
		configurable: true,
		get: () => (visible ? 'visible' : 'hidden'),
	});

	vi.stubGlobal('window', fakeWindow);
	vi.stubGlobal('document', fakeDocument);
});

afterEach(() => {
	for (const handler of registered.splice(0)) {
		googleDocsEditorAPI.removeSelectionChangeHandler(handler);
	}
	vi.useRealTimers();
});

describe('googleDocsEditorAPI selection polling', () => {
	it('pulls immediately and notifies handlers when the selection changes', async () => {
		getDocContextMock
			.mockResolvedValueOnce(CONTEXT_A) // initial pull
			.mockResolvedValue(CONTEXT_B); // subsequent polls: selection changed
		const handler = vi.fn();

		register(handler);

		// Immediate pull on registration.
		await vi.advanceTimersByTimeAsync(0);
		expect(getDocContextMock).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledTimes(1);

		// Next tick sees a changed selection -> notifies again.
		await vi.advanceTimersByTimeAsync(1000);
		expect(getDocContextMock).toHaveBeenCalledTimes(2);
		expect(handler).toHaveBeenCalledTimes(2);

		// Another tick with the same selection -> no extra notification.
		await vi.advanceTimersByTimeAsync(1000);
		expect(getDocContextMock).toHaveBeenCalledTimes(3);
		expect(handler).toHaveBeenCalledTimes(2);
	});

	it('does not touch Apps Script while the sidebar is inactive, and starts on focus', async () => {
		setSidebar(false, false);
		const handler = vi.fn();

		register(handler);

		// No pull at all while the sidebar is not in front of the user.
		await vi.advanceTimersByTimeAsync(5000);
		expect(getDocContextMock).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();

		// User returns to the sidebar: pull immediately, then poll on an interval.
		setSidebar(true, true);
		fakeWindow.emit('focus');
		await vi.advanceTimersByTimeAsync(0);
		expect(getDocContextMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1000);
		expect(getDocContextMock).toHaveBeenCalledTimes(2);
	});

	it('pauses polling when the sidebar is blurred and resumes on return', async () => {
		const handler = vi.fn();
		register(handler);

		await vi.advanceTimersByTimeAsync(1000);
		const callsWhileActive = getDocContextMock.mock.calls.length;
		expect(callsWhileActive).toBeGreaterThan(0);

		// Blur: interval stops, so advancing time makes no further calls.
		setSidebar(true, false);
		fakeWindow.emit('blur');
		await vi.advanceTimersByTimeAsync(5000);
		expect(getDocContextMock).toHaveBeenCalledTimes(callsWhileActive);

		// Refocus: polling resumes.
		setSidebar(true, true);
		fakeWindow.emit('focus');
		await vi.advanceTimersByTimeAsync(1000);
		expect(getDocContextMock.mock.calls.length).toBeGreaterThan(
			callsWhileActive,
		);
	});

	it('stops polling entirely once the last handler is removed', async () => {
		const handler = vi.fn();
		register(handler);

		await vi.advanceTimersByTimeAsync(1000);
		const callsBeforeRemoval = getDocContextMock.mock.calls.length;
		expect(callsBeforeRemoval).toBeGreaterThan(0);

		googleDocsEditorAPI.removeSelectionChangeHandler(handler);
		registered.length = 0;

		await vi.advanceTimersByTimeAsync(5000);
		expect(getDocContextMock).toHaveBeenCalledTimes(callsBeforeRemoval);
	});
});
