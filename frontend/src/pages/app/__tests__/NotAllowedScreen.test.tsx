// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppAuthSession } from '@/contexts/appAuthContext';
import { NotAllowedScreen } from '../NotAllowedScreen';

const session: Partial<AppAuthSession> = {};
vi.mock('@/contexts/appAuthContext', () => ({ useAppAuth: () => session }));

function setup(refreshUser: () => Promise<void>) {
	Object.assign(session, {
		user: { email: 'someone@gmail.com', isAllowed: false },
		refreshUser: vi.fn(refreshUser),
		logout: vi.fn(() => Promise.resolve()),
	});
	render(<NotAllowedScreen />);
}

describe('NotAllowedScreen', () => {
	afterEach(cleanup);

	it('shows which account is signed in', () => {
		setup(() => Promise.resolve());
		expect(screen.getByText('someone@gmail.com')).toBeTruthy();
	});

	it('re-checks access and says so when it is still denied', async () => {
		setup(() => Promise.resolve());
		fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
		expect(session.refreshUser).toHaveBeenCalledOnce();
		expect(await screen.findByText(/Still no access/)).toBeTruthy();
	});

	it('reports a failed check rather than claiming access is denied', async () => {
		setup(() => Promise.reject(new Error('network down')));
		fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
		expect(await screen.findByText(/Couldn’t check/)).toBeTruthy();
		expect(screen.queryByText(/Still no access/)).toBeNull();
	});
});
