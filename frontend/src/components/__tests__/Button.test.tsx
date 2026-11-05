// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../button';

afterEach(cleanup);

describe('Button', () => {
	it('defaults to type="button" so it never submits a surrounding form', () => {
		render(<Button>Go</Button>);
		expect(screen.getByRole('button', { name: 'Go' })).toHaveProperty(
			'type',
			'button',
		);
	});

	it('is disabled while loading', () => {
		const onClick = vi.fn();
		render(
			<Button loading onClick={onClick}>
				Go
			</Button>,
		);
		const button = screen.getByRole('button', { name: 'Go' });
		expect(button).toHaveProperty('disabled', true);
		fireEvent.click(button);
		expect(onClick).not.toHaveBeenCalled();
	});

	it('renders a link with its anchor attributes when given href', () => {
		render(
			<Button href="https://example.com" target="_blank" rel="noopener">
				Open
			</Button>,
		);
		const link = screen.getByRole('link', { name: 'Open' });
		expect(link.getAttribute('href')).toBe('https://example.com');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener');
	});

	it('a disabled link has no href and swallows clicks', () => {
		const onClick = vi.fn();
		render(
			<Button href="https://example.com" disabled onClick={onClick}>
				Open
			</Button>,
		);
		// Without href it is no longer a link, so it isn't exposed as one.
		expect(screen.queryByRole('link')).toBeNull();
		const anchor = screen.getByText('Open');
		expect(anchor.getAttribute('href')).toBeNull();
		expect(anchor.getAttribute('aria-disabled')).toBe('true');
		fireEvent.click(anchor);
		expect(onClick).not.toHaveBeenCalled();
	});
});
