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

	it.each([
		['C:\\Users\\writer\\OneDrive\\Essay.docx', 'Essay.docx'],
		['C:/Users/writer/OneDrive/Essay%20Draft.docx', 'Essay Draft.docx'],
		['\\\\server\\private\\team\\Shared.docx', 'Shared.docx'],
		['https://example.test/private/folder/Final%20Draft.docx', 'Final Draft.docx'],
		['https://example.test/private/folder/Bad%ZZ.docx', 'Bad%ZZ.docx'],
	])('never exposes directory components from %s', (input, expected) => {
		expect(wordDocumentLabel(input)).toBe(expected);
	});
});
