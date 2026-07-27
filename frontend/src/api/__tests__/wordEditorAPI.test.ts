import { describe, expect, it } from 'vitest';
import { wordDocumentLabel } from '../wordEditorAPI';

describe('wordDocumentLabel', () => {
	it('uses the decoded filename from the Office document URL', () => {
		expect(
			wordDocumentLabel('https://example.sharepoint.com/docs/My%20Essay.docx'),
		).toBe('My Essay.docx');
	});

	it('falls back for unsaved documents', () => {
		expect(wordDocumentLabel('')).toBe('Word document');
		expect(wordDocumentLabel(undefined)).toBe('Word document');
	});
});
