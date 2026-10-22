// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import Markdown, { defaultUrlTransform } from '..';

function CustomAnchor({ children }: { children?: React.ReactNode }) {
	return <span data-testid="custom-anchor">{children}</span>;
}

/**
 * These cover the two things `<Markdown>` adds over a bare `<Remark>`: GFM
 * syntax (which plain `remark-parse` doesn't know) and the element structure
 * the styles hang off. `react-remark` renders asynchronously, so every
 * assertion goes through `findBy*`, and each query is scoped to its own
 * `container` rather than `screen`.
 */
describe('Markdown', () => {
	// Vitest runs without `globals`, so testing-library can't register its own
	// auto-cleanup; without this every render piles up in one document and the
	// role queries match across tests.
	afterEach(cleanup);

	it('renders a GFM table', async () => {
		const { container } = render(
			<Markdown>
				{'| Draft | Revised |\n| --- | --- |\n| old | new |\n'}
			</Markdown>,
		);
		const view = within(container);

		expect((await view.findByRole('table')).tagName).toBe('TABLE');
		expect(
			await view.findByRole('columnheader', { name: 'Draft' }),
		).toBeDefined();
		expect(await view.findByRole('cell', { name: 'new' })).toBeDefined();
	});

	it('wraps a table in its own horizontal scroller', async () => {
		const { container } = render(
			<Markdown>{'| a |\n| --- |\n| 1 |\n'}</Markdown>,
		);

		const table = await within(container).findByRole('table');
		// The wrapper is what scrolls; without it a wide table widens the panel.
		expect(table.parentElement?.className).toContain('tableWrap');
	});

	// `rehype-react` hands React a `style` *string* for aligned table cells, and
	// tags every cell of an unaligned table with `align: null`. In a production
	// build React rejects the string outright (error #62) and the page falls to
	// its error boundary, so these two guard `rehypeTableCellStyle`. See the
	// comment in `tableCellStyle.ts`.
	it('applies column alignment as a style object', async () => {
		const { container } = render(
			<Markdown>
				{'| l | c | r |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n'}
			</Markdown>,
		);

		await within(container).findByRole('table');
		const headers = container.querySelectorAll('th');
		expect([...headers].map((th) => th.style.textAlign)).toEqual([
			'left',
			'center',
			'right',
		]);
	});

	it('leaves an unaligned table with no style at all', async () => {
		const { container } = render(
			<Markdown>{'| a |\n| --- |\n| 1 |\n'}</Markdown>,
		);

		await within(container).findByRole('table');
		for (const cell of container.querySelectorAll('th, td')) {
			// Not `text-align: null`, and not an empty style attribute either.
			expect(cell.getAttribute('style')).toBeNull();
		}
	});

	it('renders list items as real list elements', async () => {
		const { container } = render(<Markdown>{'- one\n- two\n'}</Markdown>);

		const items = await within(container).findAllByRole('listitem');
		expect(items.map((li) => li.textContent)).toEqual(['one', 'two']);
		expect(items[0].parentElement?.tagName).toBe('UL');
	});

	it('renders ordered lists, and nests a sublist inside its item', async () => {
		const { container } = render(
			<Markdown>{'1. one\n2. two\n   - nested\n'}</Markdown>,
		);

		const lists = await within(container).findAllByRole('list');
		expect(lists.map((list) => list.tagName)).toEqual(['OL', 'UL']);
		expect((await within(container).findAllByRole('listitem')).length).toBe(
			3,
		);
	});

	it('supports the rest of GFM (strikethrough, task lists)', async () => {
		const { container } = render(
			<Markdown>{'~~gone~~\n\n- [x] done\n- [ ] todo\n'}</Markdown>,
		);

		expect(await within(container).findByText('gone')).toBeDefined();
		expect(container.querySelector('del')).not.toBeNull();
		expect(
			container.querySelectorAll('input[type="checkbox"]').length,
		).toBe(2);
	});

	it('lets a caller override an element component', async () => {
		const { container } = render(
			<Markdown components={{ a: CustomAnchor }}>
				{'[jump](#somewhere)'}
			</Markdown>,
		);

		expect(
			await within(container).findByTestId('custom-anchor'),
		).toBeDefined();
	});

	// React Markdown blanks out any URL scheme outside its safe list, which is
	// what stops a `javascript:` link in model output from going live. Revise's
	// `doctext:` citations need an exemption, so both halves are worth pinning.
	it('drops an unsafe URL scheme by default', async () => {
		const { container } = render(
			<Markdown>{'[click](javascript:alert(1))'}</Markdown>,
		);

		await within(container).findByText('click');
		// Blanked, not removed — and an <a> with an empty href is no longer
		// exposed as a link, which is why this queries the element directly.
		const link = container.querySelector('a');
		expect(link?.getAttribute('href')).toBe('');
	});

	it('lets a caller allow a scheme of its own', async () => {
		const { container } = render(
			<Markdown
				urlTransform={(url) =>
					url.startsWith('doctext:') ? url : defaultUrlTransform(url)
				}
			>
				{'[quoted line](doctext:Some%20text)'}
			</Markdown>,
		);

		const link = await within(container).findByRole('link');
		expect(link.getAttribute('href')).toBe('doctext:Some%20text');
	});
});
