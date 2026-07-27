import { describe, expect, it } from 'vitest';
import {
	FIRST_PARTY_TOOLS,
	resolveMindmapToolUrl,
} from './index';

describe('mindmap tool registration', () => {
	it('uses local and production URL defaults with an environment override', () => {
		expect(resolveMindmapToolUrl(undefined, true)).toBe(
			'http://localhost:5181/',
		);
		expect(resolveMindmapToolUrl(undefined, false)).toBe(
			'https://mindmap.thoughtful-ai.com/',
		);
		expect(resolveMindmapToolUrl('https://preview.example/', true)).toBe(
			'https://preview.example/',
		);
	});

	it('requests only AI and optional document-read access', () => {
		const mindmap = FIRST_PARTY_TOOLS.find((tool) => tool.id === 'mindmap');
		expect(mindmap?.scopes).toEqual(['openai:chat', 'doc:read']);
		expect(mindmap?.scopes).not.toContain('log:write');
		expect(FIRST_PARTY_TOOLS.map((tool) => tool.id)).toEqual(['mindmap']);
	});
});
