import { describe, expect, it, vi } from 'vitest';
import type { DocumentSettingsAPI } from '@/api/documentSettings';
import {
	DOC_ID_SETTING_KEY,
	getOrCreateDocId,
	LOG_SESSION_ID,
} from '../logIdentity';

function fakeSettings(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	const settings: DocumentSettingsAPI = {
		getDocumentSetting: vi.fn((key: string) =>
			Promise.resolve(store.get(key) ?? null),
		),
		setDocumentSetting: vi.fn((key: string, value: string) => {
			store.set(key, value);
			return Promise.resolve();
		}),
	};
	return { settings, store };
}

describe('getOrCreateDocId', () => {
	it('mints an id and stores it in the document', async () => {
		const { settings, store } = fakeSettings();
		const id = await getOrCreateDocId(settings);
		expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
		expect(store.get(DOC_ID_SETTING_KEY)).toBe(id);
	});

	it('reuses the id already stored in the document', async () => {
		const existing = '0b6f3c1e-1d2a-4c8e-9a51-2f7d3b9e6c10';
		const { settings } = fakeSettings({ [DOC_ID_SETTING_KEY]: existing });
		expect(await getOrCreateDocId(settings)).toBe(existing);
		expect(settings.setDocumentSetting).not.toHaveBeenCalled();
	});

	it('replaces a stored value that is not an id', async () => {
		const { settings } = fakeSettings({
			[DOC_ID_SETTING_KEY]: 'not an id!',
		});
		const id = await getOrCreateDocId(settings);
		expect(id).not.toBe('not an id!');
		expect(settings.setDocumentSetting).toHaveBeenCalledOnce();
	});

	it('agrees on one id, written once, when events race on a fresh document', async () => {
		const { settings } = fakeSettings();
		const ids = await Promise.all([
			getOrCreateDocId(settings),
			getOrCreateDocId(settings),
			getOrCreateDocId(settings),
		]);
		expect(new Set(ids).size).toBe(1);
		expect(settings.setDocumentSetting).toHaveBeenCalledOnce();
	});

	it('still returns an id when the document cannot be written', async () => {
		const settings: DocumentSettingsAPI = {
			getDocumentSetting: () => Promise.resolve(null),
			setDocumentSetting: () => Promise.reject(new Error('read-only')),
		};
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await expect(getOrCreateDocId(settings)).resolves.toMatch(
			/^[A-Za-z0-9-]{8,64}$/,
		);
		warn.mockRestore();
	});

	it('gives different documents different ids', async () => {
		const a = await getOrCreateDocId(fakeSettings().settings);
		const b = await getOrCreateDocId(fakeSettings().settings);
		expect(a).not.toBe(b);
	});
});

describe('LOG_SESSION_ID', () => {
	it('is an id the server will accept', () => {
		expect(LOG_SESSION_ID).toMatch(/^[A-Za-z0-9-]{8,64}$/);
	});
});
