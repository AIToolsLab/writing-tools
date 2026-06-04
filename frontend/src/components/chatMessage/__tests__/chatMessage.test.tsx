// @vitest-environment jsdom
//
// Component tests for ChatMessage (src/components/chatMessage/index.tsx).
//
// ChatMessage is a pure presentational component: it renders one chat bubble,
// aligned by role, with its markdown content rendered via react-remark. We
// render it in isolation, feed props, and assert what it puts in the DOM. The
// refresh/delete/comment toolbar is commented out in the component, so those
// callback props are unwired and we just pass no-ops.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ChatMessage from '../index';

afterEach(cleanup);

// Required by the props type but unused (toolbar is commented out).
const callbacks = {
	index: 0,
	refresh: () => {},
	deleteMessage: () => {},
	convertToComment: () => {},
};

describe('ChatMessage', () => {
	it('renders the message content', async () => {
		render(<ChatMessage role="user" content="Hello world" {...callbacks} />);

		// findByText throws if the text never appears, so this is the assertion.
		await screen.findByText('Hello world');
	});

	it.each([
		['user', 'justify-end'],
		['assistant', 'justify-start'],
	])('aligns a %s message with %s', (role, expectedClass) => {
		const { container } = render(
			<ChatMessage role={role} content="hi" {...callbacks} />,
		);

		expect((container.firstChild as HTMLElement).className).toContain(
			expectedClass,
		);
	});

	it('renders markdown as real HTML elements', async () => {
		render(<ChatMessage role="assistant" content="**bold**" {...callbacks} />);

		// "**bold**" should become a <strong>, not literal asterisks.
		const strong = await screen.findByText('bold');
		expect(strong.tagName).toBe('STRONG');
	});
});
