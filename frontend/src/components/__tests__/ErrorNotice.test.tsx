import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GenerationErrorInfo } from '@/api/errors';
import { ErrorNotice, GenerationErrorNotice } from '../errorNotice';

const quotaFailure: GenerationErrorInfo = {
	message: 'The AI account behind this add-in is out of credit.',
	detail: 'You exceeded your current quota.',
	code: 'insufficient_quota',
	retryable: false,
};

describe('ErrorNotice', () => {
	it('announces the failure and shows the writer-facing message', () => {
		const html = renderToStaticMarkup(
			<ErrorNotice message="Something specific went wrong." />,
		);

		expect(html).toContain('role="alert"');
		expect(html).toContain('Something specific went wrong.');
	});

	it('keeps the raw provider text collapsed behind a toggle', () => {
		const html = renderToStaticMarkup(
			<ErrorNotice message="Failed." detail="insufficient_quota" />,
		);

		expect(html).toContain('Technical details');
		expect(html).not.toContain('>insufficient_quota<');
	});

	it('omits Retry when there is nothing to retry with', () => {
		const html = renderToStaticMarkup(<ErrorNotice message="Failed." />);

		expect(html).not.toContain('Try again');
	});

	it('uses a non-alerting role for informational notices', () => {
		const html = renderToStaticMarkup(
			<ErrorNotice tone="info" message="Nothing came back." />,
		);

		expect(html).toContain('role="status"');
	});
});

describe('GenerationErrorNotice', () => {
	it('does not offer Retry for a failure retrying cannot clear', () => {
		const html = renderToStaticMarkup(
			<GenerationErrorNotice info={quotaFailure} onRetry={vi.fn()} />,
		);

		expect(html).toContain('out of credit');
		expect(html).not.toContain('Try again');
	});

	it('offers Retry for a transient failure', () => {
		const html = renderToStaticMarkup(
			<GenerationErrorNotice
				info={{ ...quotaFailure, retryable: true }}
				onRetry={vi.fn()}
			/>,
		);

		expect(html).toContain('Try again');
	});
});
