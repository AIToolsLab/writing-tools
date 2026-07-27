// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DocGoalsContext,
	type DocGoalsContextValue,
	EMPTY_DOC_GOALS,
} from '@/contexts/docGoalsContext';
import ToDoSection from '../toDoSection';

vi.mock('@/hooks/useLog', () => ({ useLog: () => vi.fn() }));

function renderSection(
	value: Partial<DocGoalsContextValue> = {},
	props: { step?: number; defaultOpen?: boolean } = {},
) {
	const contextValue: DocGoalsContextValue = {
		goals: EMPTY_DOC_GOALS,
		setGoal: vi.fn(),
		status: 'ready',
		...value,
	};
	render(
		<DocGoalsContext.Provider value={contextValue}>
			<ToDoSection page="revise" {...props} />
		</DocGoalsContext.Provider>,
	);
	return contextValue;
}

describe('ToDoSection', () => {
	afterEach(cleanup);

	it('starts collapsed, so it costs one line on pages that are not Revise', () => {
		renderSection();

		expect(screen.queryByLabelText('Audience')).toBeNull();
		expect(screen.getByRole('button', { name: /Set your to-do/ })).toHaveProperty(
			'ariaExpanded',
			'false',
		);
	});

	it('opens by default where the caller asks for it', () => {
		renderSection({}, { defaultOpen: true, step: 1 });

		expect(screen.getByLabelText('Audience')).toBeTruthy();
		expect(screen.getByLabelText('Guardrails')).toBeTruthy();
		expect(screen.getByLabelText('Additional comments')).toBeTruthy();
	});

	// Collapsed, the header is the only signal that a to-do is in effect.
	it('names the filled fields in the collapsed header', () => {
		renderSection({
			goals: {
				audience: 'First-year students',
				guardrails: '',
				comments: 'Peer review draft',
			},
		});

		const header = screen.getByRole('button', { name: /Set your to-do/ });
		expect(header.textContent).toContain('Audience');
		expect(header.textContent).toContain('Additional comments');
		expect(header.textContent).not.toContain('Guardrails');
	});

	it('says so when nothing is set', () => {
		renderSection();

		expect(
			screen.getByRole('button', { name: /Set your to-do/ }).textContent,
		).toContain('Not set yet');
	});

	it('expands on click', () => {
		renderSection();

		fireEvent.click(screen.getByRole('button', { name: /Set your to-do/ }));

		expect(screen.getByLabelText('Audience')).toBeTruthy();
	});

	it('shows the stored values and reports edits to the shared context', () => {
		const context = renderSection(
			{
				goals: {
					audience: 'First-year students',
					guardrails: '',
					comments: '',
				},
			},
			{ defaultOpen: true },
		);

		const audience =
			screen.getByLabelText<HTMLTextAreaElement>('Audience');
		expect(audience.value).toBe('First-year students');

		fireEvent.change(audience, { target: { value: 'Reviewers' } });

		expect(context.setGoal).toHaveBeenCalledWith('audience', 'Reviewers');
	});

	// Typing into a field that is about to be replaced by the stored value would
	// lose the keystrokes.
	it('locks the fields until the stored to-do has loaded', () => {
		renderSection({ status: 'loading' }, { defaultOpen: true });

		expect(
			screen.getByLabelText<HTMLTextAreaElement>('Audience').disabled,
		).toBe(true);
	});

	it('tells the writer when the to-do could not be saved', () => {
		renderSection({ status: 'error' }, { defaultOpen: true });

		expect(document.body.textContent).toContain("Couldn't save your to-do");
	});
});
