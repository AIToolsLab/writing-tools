// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DocBriefContext,
	type DocBriefContextValue,
	EMPTY_DOC_BRIEF,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import BriefSection from '../briefSection';

vi.mock('@/hooks/useLog', () => ({ useLog: () => vi.fn() }));

// The section can ask for candidate wording; the request itself is covered in
// `api/__tests__/briefProposal.test.ts`, so here it is stubbed to keep these
// tests about what the writer sees and what reaches the brief.
const requestBriefProposal = vi.hoisted(() => vi.fn());
vi.mock('@/api/briefProposal', () => ({ requestBriefProposal }));

function renderSection(
	value: Partial<DocBriefContextValue> = {},
	props: {
		step?: number;
		defaultOpen?: boolean;
		/** Document text the section reads when drafting. Empty by default. */
		docText?: string;
	} = {},
) {
	const { docText, ...sectionProps } = props;
	const contextValue: DocBriefContextValue = {
		brief: EMPTY_DOC_BRIEF,
		setField: vi.fn(),
		status: 'ready',
		proposals: {},
		setProposals: vi.fn(),
		acceptProposal: vi.fn(),
		dismissProposal: vi.fn(),
		...value,
	};
	const section = (
		<DocBriefContext.Provider value={contextValue}>
			<BriefSection page="revise" {...sectionProps} />
		</DocBriefContext.Provider>
	);

	// With no `docText`, the bare EditorContext default is used — which resolves
	// an empty document, and is itself worth exercising.
	render(
		docText === undefined ? (
			section
		) : (
			<EditorContext.Provider
				value={
					{
						getDocContext: () =>
							Promise.resolve({
								beforeCursor: docText,
								selectedText: '',
								afterCursor: '',
							}),
					} as EditorAPI
				}
			>
				{section}
			</EditorContext.Provider>
		),
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

describe('BriefSection proposals', () => {
	afterEach(() => {
		cleanup();
		requestBriefProposal.mockReset();
	});

	// The whole point of the provisional rendering: a candidate must be visible
	// as a candidate, and must not be sitting in the field as though the writer
	// had written it.
	it('shows a candidate beside the field without putting it in the field', () => {
		renderSection(
			{ proposals: { audience: 'Reviewers for a registered report' } },
			{ defaultOpen: true },
		);

		expect(document.body.textContent).toContain(
			'Reviewers for a registered report',
		);
		expect(
			screen.getByLabelText<HTMLTextAreaElement>('Audience').value,
		).toBe('');
	});

	it('offers a candidate even for a field the writer has already filled in', () => {
		renderSection(
			{
				brief: {
					audience: 'Reviewers',
					purpose: '',
					constraints: '',
				},
				proposals: { audience: 'Reviewers for a registered report' },
			},
			{ defaultOpen: true },
		);

		// Their own wording stays put; the sharper version is offered alongside.
		expect(
			screen.getByLabelText<HTMLTextAreaElement>('Audience').value,
		).toBe('Reviewers');
		expect(document.body.textContent).toContain(
			'Reviewers for a registered report',
		);
	});

	it('takes a candidate into the brief only when the writer accepts it', () => {
		const context = renderSection(
			{
				proposals: {
					purpose: 'Convince reviewers the design is sound',
				},
			},
			{ defaultOpen: true },
		);

		expect(context.acceptProposal).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Use this' }));

		expect(context.acceptProposal).toHaveBeenCalledWith('purpose');
	});

	it('drops a dismissed candidate without touching the field', () => {
		const context = renderSection(
			{ proposals: { constraints: '- Under 8 pages' } },
			{ defaultOpen: true },
		);

		fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

		expect(context.dismissProposal).toHaveBeenCalledWith('constraints');
		expect(context.setField).not.toHaveBeenCalled();
	});

	it('hands the returned candidates to the shared context', async () => {
		requestBriefProposal.mockResolvedValue({ audience: 'Reviewers' });
		const context = renderSection(
			{},
			{ defaultOpen: true, docText: 'A draft about registered reports.' },
		);

		fireEvent.click(
			screen.getByRole('button', { name: 'Draft from my document' }),
		);

		await waitFor(() => {
			expect(context.setProposals).toHaveBeenCalledWith({
				audience: 'Reviewers',
			});
		});
	});

	// The default EditorContext resolves an empty document, so this is the
	// no-provider case — a run that silently changes nothing reads as a broken
	// button, so it has to say why.
	it('says so rather than generating from an empty document', async () => {
		renderSection({}, { defaultOpen: true });

		fireEvent.click(
			screen.getByRole('button', { name: 'Draft from my document' }),
		);

		await waitFor(() => {
			expect(document.body.textContent).toContain('Nothing to read yet');
		});
		expect(requestBriefProposal).not.toHaveBeenCalled();
	});
});
