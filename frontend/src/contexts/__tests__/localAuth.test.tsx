// @vitest-environment jsdom
import React from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppAuthProvider, useAppAuth } from '../appAuthContext';

vi.mock('@/hooks/useDeviceAuth', () => ({
	useDeviceAuth: () => ({ status: 'idle' }),
}));
vi.mock('@/hooks/useAnonymousAuth', () => ({ useAnonymousAuth: vi.fn() }));
vi.mock('@/api/openai', () => ({ setOpenAITokenProvider: vi.fn() }));

afterEach(cleanup);

it('allows explicit localhost development without inventing a bearer token or logging consent', async () => {
	vi.stubEnv('DEV', true);
	vi.stubEnv('VITE_LOCAL_AUTH_DISABLED', 'true');
	const { result } = renderHook(useAppAuth, { wrapper: AppAuthProvider });
	expect(result.current.provider).toBe('local');
	expect(result.current.user?.isAllowed).toBe(true);
	expect(result.current.loggingConsent).toBe('none');
	expect(await result.current.getAccessToken()).toBe('');
});

it('requires normal authentication without explicit opt-in', () => {
	vi.stubEnv('DEV', true);
	vi.stubEnv('VITE_LOCAL_AUTH_DISABLED', 'false');
	const { result } = renderHook(useAppAuth, { wrapper: AppAuthProvider });
	expect(result.current.provider).toBe('betterauth');
	expect(result.current.isAuthenticated).toBe(false);
});

it('cannot enable local authentication in production', () => {
	vi.stubEnv('DEV', false);
	vi.stubEnv('VITE_LOCAL_AUTH_DISABLED', 'true');
	const { result } = renderHook(useAppAuth, { wrapper: AppAuthProvider });
	expect(result.current.provider).toBe('betterauth');
});

it('cannot enable local authentication on a remote host', () => {
	vi.stubEnv('DEV', true);
	vi.stubEnv('VITE_LOCAL_AUTH_DISABLED', 'true');
	vi.stubGlobal('location', { hostname: 'app.example.com' });
	const { result } = renderHook(useAppAuth, { wrapper: AppAuthProvider });
	expect(result.current.provider).toBe('betterauth');
});
