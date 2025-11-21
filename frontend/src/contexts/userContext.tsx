import { atom } from 'jotai';
export const usernameAtom = atom<string>(
	typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('username') || ''
		: '',
);
