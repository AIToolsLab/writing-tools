import { atom } from 'jotai';
export const usernameAtom = atom<string>(new URLSearchParams(window.location.search).get('username') || '');
