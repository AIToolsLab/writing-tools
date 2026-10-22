// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DocBriefContext,
	type DocBriefContextValue,
	EMPTY_DOC_BRIEF,
} from '@/contexts/docBriefContext';
import BriefSection from '../briefSection';

vi.mock('@/hooks/useLog', () => ({ useLog: () => vi.fn() }));

function renderSection(
	value: Partial<DocBriefContextValue> = {},
	props: { step?: number; defaultOpen?: boolean } = {},
) {
	const contextValue: DocBriefContextValue = {
		brief: EMPTY_DOC_BRIEF,
		setField: vi.fn(),
		status: 'ready',
		...value,
	};
	render(
		<DocBriefContext.Provider value={contextValue}>
			<BriefSection page="revise" {...props} />
		</DocBriefContext.Provider>,
	);
	return contextValue;
}

describe('BriefSection', () => {
	afterEach(cleanup);

	it('starts collapsed, so it costs one line on pages that are not Revise', () => {
		renderSection();

		expect(screen.queryByLabelText('Audience')).toBeNull();
		expect(
			screen.getByRole('button', { name: /Set your brief/ }),
		).toHaveProperty('ariaExpanded', 'false');
	});

	it('opens by default where the caller asks for it', () => {
		renderSection({}, { defaultOpen: true, step: 1 });

		expect(screen.getByLabelText('Audience')).toBeTruthy();
		expect(screen.getByLabelText('Purpose')).toBeTruthy();
		expect(screen.getByLabelText('Constraints')).toBeTruthy();
	});

	// Collapsed, the header is the only signal that a brief is in effect.
	it('names the filled fields in the collapsed header', () => {
		renderSection({
			brief: {
				audience: 'First-year students',
				purpose: '',
				constraints: 'Under 400 words',
			},
		});

		const header = screen.getByRole('button', { name: /Set your brief/ });
		expect(header.textContent).toContain('Audience');
		expect(header.textContent).toContain('Constraints');
		expect(header.textContent).not.toContain('Purpose');
	});

	it('says so when nothing is set', () => {
		renderSection();

		expect(
			screen.getByRole('button', { name: /Set your brief/ }).textContent,
		).toContain('Not set yet');
	});

	it('expands on click', () => {
		renderSection();

		fireEvent.click(screen.getByRole('button', { name: /Set your brief/ }));

		expect(screen.getByLabelText('Audience')).toBeTruthy();
	});

	it('shows the stored values and reports edits to the shared context', () => {
		const context = renderSection(
			{
				brief: {
					audience: 'First-year students',
					purpose: '',
					constraints: '',
				},
			},
			{ defaultOpen: true },
		);

		const audience = screen.getByLabelText<HTMLTextAreaElement>('Audience');
		expect(audience.value).toBe('First-year students');

		fireEvent.change(audience, { target: { value: 'Reviewers' } });

		expect(context.setField).toHaveBeenCalledWith('audience', 'Reviewers');
	});

	// Typing into a field that is about to be replaced by the stored value would
	// lose the keystrokes.
	it('locks the fields until the stored brief has loaded', () => {
		renderSection({ status: 'loading' }, { defaultOpen: true });

		expect(
			screen.getByLabelText<HTMLTextAreaElement>('Audience').disabled,
		).toBe(true);
	});

	it('tells the writer when the brief could not be saved', () => {
		renderSection({ status: 'error' }, { defaultOpen: true });

		expect(document.body.textContent).toContain("Couldn't save your brief");
	});
});
