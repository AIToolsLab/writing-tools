// @vitest-environment jsdom
//
// Component tests for Navbar (src/components/navbar/index.tsx).
//
// Navbar renders one tab button per page and drives `pageNameAtom` (Jotai) when
// a tab is clicked. We render it wired to a fresh Jotai store, query buttons by
// accessible role the way a user would, and assert the atom it controls — not
// CSS module class names (Vitest doesn't resolve them and they're brittle). This
// also covers the pageContext atom transition for free.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { PageName, pageNameAtom } from '@/contexts/pageContext';
import Navbar from '../index';

afterEach(cleanup);

// Fresh store per test so clicks can't leak between tests.
function renderNavbar() {
	const store = createStore();
	render(
		<Provider store={store}>
			<Navbar />
		</Provider>,
	);
	return store;
}

const tab = (name: RegExp) => screen.getByRole('button', { name });

describe('Navbar', () => {
	it('renders a button for each page', () => {
		renderNavbar();

		// getByRole throws if a button is missing, so these are the assertions.
		tab(/Draft/);
		tab(/Revise/);
		tab(/Chat/);
	});

	it('starts on the Draft page', () => {
		const store = renderNavbar();

		expect(store.get(pageNameAtom)).toBe(PageName.Draft);
	});

	it('switches the page atom when a tab is clicked', () => {
		const store = renderNavbar();

		fireEvent.click(tab(/Chat/));
		expect(store.get(pageNameAtom)).toBe(PageName.Chat);

		fireEvent.click(tab(/Revise/));
		expect(store.get(pageNameAtom)).toBe(PageName.Revise);
	});
});
