import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConsentLevelChooser } from '../ConsentLevelChooser';

describe('ConsentLevelChooser', () => {
	it('does not offer study logging as a new opt-in by default', () => {
		const html = renderToStaticMarkup(
			<ConsentLevelChooser value="usage" onChange={vi.fn()} />,
		);

		expect(html).not.toContain('value="document"');
	});

	it('shows document when it is the current level', () => {
		const html = renderToStaticMarkup(
			<ConsentLevelChooser value="document" onChange={vi.fn()} />,
		);

		expect(html).toContain('value="document"');
		expect(html).toContain('checked="" value="document"');
	});

	it('offers document during the explicit study flow', () => {
		const html = renderToStaticMarkup(
			<ConsentLevelChooser
				value="usage"
				onChange={vi.fn()}
				allowStudyLevel
			/>,
		);

		expect(html).toContain('value="document"');
	});
});
