import { atom } from 'jotai';

// The username can be supplied via the `?username=` query param (used by researchers to
// attribute logs). Guard `window` so the atom can be evaluated during SSR.
function initialUsername(): string {
	if (typeof window === 'undefined') return '';
	return new URLSearchParams(window.location.search).get('username') || '';
}

export const usernameAtom = atom<string>(initialUsername());
