// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localStorageDocumentSettings } from '../documentSettings';

describe('localStorageDocumentSettings', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('reads back what it wrote', async () => {
		const settings = localStorageDocumentSettings('doc-1');

		await settings.setDocumentSetting('writerToDo', '{"audience":"peers"}');

		expect(await settings.getDocumentSetting('writerToDo')).toBe(
			'{"audience":"peers"}',
		);
	});

	it('resolves to null for a key that was never written', async () => {
		const settings = localStorageDocumentSettings('doc-1');

		expect(await settings.getDocumentSetting('writerToDo')).toBeNull();
	});

	// Two documents open in one browser must not share one to-do.
	it('keeps each document namespace separate', async () => {
		const first = localStorageDocumentSettings('doc-1');
		const second = localStorageDocumentSettings('doc-2');

		await first.setDocumentSetting('writerToDo', 'first');

		expect(await second.getDocumentSetting('writerToDo')).toBeNull();
		expect(await first.getDocumentSetting('writerToDo')).toBe('first');
	});

	// A full or unavailable store is a lost preference, never a thrown error
	// into a page the writer is in the middle of using.
	it('swallows storage failures', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});
		const settings = localStorageDocumentSettings('doc-1');

		await expect(
			settings.setDocumentSetting('writerToDo', 'value'),
		).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalled();
	});
});
