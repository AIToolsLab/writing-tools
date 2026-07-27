// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DOC_GOALS_SETTING_KEY,
	DocGoalsContext,
	DocGoalsProvider,
	EMPTY_DOC_GOALS,
	filledDocGoalFields,
	formatDocGoalsForPrompt,
	hasDocGoals,
	parseDocGoals,
} from '../docGoalsContext';
import { EditorContext } from '../editorContext';

describe('parseDocGoals', () => {
	it('reads back what the provider wrote', () => {
		const goals = {
			audience: 'First-year students',
			guardrails: "Don't touch the intro",
			comments: 'Draft for peer review',
		};
		expect(parseDocGoals(JSON.stringify(goals))).toEqual(goals);
	});

	it('treats a never-written setting as an empty to-do', () => {
		expect(parseDocGoals(null)).toEqual(EMPTY_DOC_GOALS);
	});

	// A document can carry a value written by a different build of the add-in,
	// so nothing stored is trusted to have the shape we expect.
	it('degrades to empty rather than throwing on unreadable JSON', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(parseDocGoals('not json at all')).toEqual(EMPTY_DOC_GOALS);
	});

	it('keeps recognized string fields and drops everything else', () => {
		const parsed = parseDocGoals(
			JSON.stringify({ audience: 'Reviewers', guardrails: 7, extra: 'x' }),
		);
		expect(parsed).toEqual({
			audience: 'Reviewers',
			guardrails: '',
			comments: '',
		});
	});
});

describe('formatDocGoalsForPrompt', () => {
	it('returns null when nothing is set, so pages send no to-do block', () => {
		expect(formatDocGoalsForPrompt(EMPTY_DOC_GOALS)).toBeNull();
		expect(hasDocGoals(EMPTY_DOC_GOALS)).toBe(false);
	});

	it('lists only the fields the writer filled in', () => {
		const prompt = formatDocGoalsForPrompt({
			audience: 'First-year students',
			guardrails: '   ',
			comments: '',
		});

		expect(prompt).toContain('- Audience: First-year students');
		expect(prompt).not.toContain('Guardrails');
		expect(prompt).not.toContain('Additional comments');
	});

	it('ignores whitespace-only fields when reporting what is set', () => {
		expect(
			filledDocGoalFields({
				audience: '  ',
				guardrails: 'Keep it under 400 words',
				comments: '',
			}),
		).toEqual(['guardrails']);
	});
});

/** A stub editor whose document settings live in a plain object. */
function stubEditorAPI(stored: Record<string, string> = {}) {
	const getDocumentSetting = vi.fn(
		(key: string): Promise<string | null> =>
			Promise.resolve(stored[key] ?? null),
	);
	const setDocumentSetting = vi.fn((key: string, value: string) => {
		stored[key] = value;
		return Promise.resolve();
	});
	return {
		stored,
		getDocumentSetting,
		setDocumentSetting,
		api: {
			getDocContext: () =>
				Promise.resolve({
					beforeCursor: '',
					selectedText: '',
					afterCursor: '',
				}),
			addSelectionChangeHandler: () => {},
			removeSelectionChangeHandler: () => {},
			selectPhrase: () => Promise.resolve(),
			getDocumentSetting,
			setDocumentSetting,
		} satisfies EditorAPI,
	};
}

/** Exposes the context so a test can read the goals and drive an edit. */
function Probe() {
	const { goals, setGoal, status } = useContext(DocGoalsContext);
	return (
		<div>
			<span data-testid="audience">{goals.audience}</span>
			<span data-testid="status">{status}</span>
			<button type="button" onClick={() => setGoal('audience', 'Reviewers')}>
				edit
			</button>
		</div>
	);
}

describe('DocGoalsProvider', () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		// The suite runs without Vitest globals, so Testing Library's automatic
		// afterEach cleanup never registers — unmount explicitly or every render
		// stays in the document and the queries find several matches.
		cleanup();
		vi.useRealTimers();
	});

	it('loads the to-do stored with the document', async () => {
		const editor = stubEditorAPI({
			[DOC_GOALS_SETTING_KEY]: JSON.stringify({
				audience: 'First-year students',
				guardrails: '',
				comments: '',
			}),
		});

		render(
			<EditorContext.Provider value={editor.api}>
				<DocGoalsProvider>
					<Probe />
				</DocGoalsProvider>
			</EditorContext.Provider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId('audience').textContent).toBe(
				'First-year students',
			);
		});
		expect(editor.getDocumentSetting).toHaveBeenCalledWith(
			DOC_GOALS_SETTING_KEY,
		);
	});

	it('writes edits back to the document, debounced', async () => {
		const editor = stubEditorAPI();

		render(
			<EditorContext.Provider value={editor.api}>
				<DocGoalsProvider>
					<Probe />
				</DocGoalsProvider>
			</EditorContext.Provider>,
		);
		await waitFor(() => {
			expect(screen.getByTestId('status').textContent).toBe('ready');
		});

		act(() => {
			screen.getByRole('button', { name: 'edit' }).click();
		});

		// Not yet — a save per keystroke is a round-trip per keystroke.
		expect(editor.setDocumentSetting).not.toHaveBeenCalled();
		expect(screen.getByTestId('status').textContent).toBe('saving');

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(editor.setDocumentSetting).toHaveBeenCalledTimes(1);
		expect(parseDocGoals(editor.stored[DOC_GOALS_SETTING_KEY])).toEqual({
			audience: 'Reviewers',
			guardrails: '',
			comments: '',
		});
		expect(screen.getByTestId('status').textContent).toBe('ready');
	});

	// The empty initial state must never reach the document: it would blank out
	// a to-do the writer saved in an earlier session.
	it('does not write anything before the stored value has loaded', async () => {
		const editor = stubEditorAPI();
		// A read that hasn't come back yet — the window in which an edit could
		// otherwise overwrite a to-do saved in an earlier session.
		editor.getDocumentSetting.mockReturnValue(new Promise(() => {}));

		render(
			<EditorContext.Provider value={editor.api}>
				<DocGoalsProvider>
					<Probe />
				</DocGoalsProvider>
			</EditorContext.Provider>,
		);
		expect(screen.getByTestId('status').textContent).toBe('loading');

		act(() => {
			screen.getByRole('button', { name: 'edit' }).click();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(editor.setDocumentSetting).not.toHaveBeenCalled();
	});

	it('flushes a pending edit on unmount instead of losing it', async () => {
		const editor = stubEditorAPI();

		const view = render(
			<EditorContext.Provider value={editor.api}>
				<DocGoalsProvider>
					<Probe />
				</DocGoalsProvider>
			</EditorContext.Provider>,
		);
		await waitFor(() => {
			expect(screen.getByTestId('status').textContent).toBe('ready');
		});

		act(() => {
			screen.getByRole('button', { name: 'edit' }).click();
		});
		view.unmount();

		await waitFor(() => {
			expect(editor.setDocumentSetting).toHaveBeenCalledTimes(1);
		});
	});

	it('reports a failed write so the writer knows the to-do is session-only', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const editor = stubEditorAPI();
		editor.setDocumentSetting.mockRejectedValue(new Error('read-only doc'));

		render(
			<EditorContext.Provider value={editor.api}>
				<DocGoalsProvider>
					<Probe />
				</DocGoalsProvider>
			</EditorContext.Provider>,
		);
		await waitFor(() => {
			expect(screen.getByTestId('status').textContent).toBe('ready');
		});

		act(() => {
			screen.getByRole('button', { name: 'edit' }).click();
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(screen.getByTestId('status').textContent).toBe('error');
		// The edit still applies to this session's prompts.
		expect(screen.getByTestId('audience').textContent).toBe('Reviewers');
	});
});
