import { describe, expect, it, vi } from 'vitest';
import {
	isMindmapToolEnabled,
	launchFirstPartyTool,
	MINDMAP_TOOL,
	resolveMindmapToolUrl,
	type FirstPartyTool,
} from '../index';

const mindmap: FirstPartyTool = {
	id: 'mindmap',
	name: 'Mindmap',
	description: 'Test mindmap',
	url: 'https://mindmap.example/',
	scopes: ['openai:chat', 'doc:read'],
	launchKind: 'room-oauth',
};

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

	it('defaults on in development and off in production, with explicit overrides', () => {
		expect(isMindmapToolEnabled(undefined, true)).toBe(true);
		expect(isMindmapToolEnabled(undefined, false)).toBe(false);
		expect(isMindmapToolEnabled('true', false)).toBe(true);
		expect(isMindmapToolEnabled('false', true)).toBe(false);
	});

	it('requests AI and document-read access without the retired logging scope', () => {
		expect(MINDMAP_TOOL.scopes).toEqual(['openai:chat', 'doc:read']);
		expect(MINDMAP_TOOL.scopes).not.toContain('log:write');
	});

	it('does not access the document or backend when the popup is blocked', async () => {
		const getAccessToken = vi.fn();
		const getDocContext = vi.fn();
		const createRoom = vi.fn();
		await expect(
			launchFirstPartyTool(mindmap, {
				getAccessToken,
				getDocContext,
				createRoom,
				reserveLaunch: () => null,
				completeLaunch: vi.fn(),
				cancelLaunch: vi.fn(),
			}),
		).rejects.toThrow('blocked');
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(getDocContext).not.toHaveBeenCalled();
		expect(createRoom).not.toHaveBeenCalled();
	});

	it('reserves before reading a document and completes a granted launch', async () => {
		const calls: string[] = [];
		const result = await launchFirstPartyTool(mindmap, {
			getAccessToken: () => {
				calls.push('token');
				return Promise.resolve('token');
			},
			getDocContext: () => {
				calls.push('doc');
				return Promise.resolve({
					beforeCursor: 'draft',
					selectedText: '',
					afterCursor: '',
				});
			},
			createRoom: () => {
				calls.push('room');
				return Promise.resolve({ id: 'room_123', name: 'Draft' });
			},
			reserveLaunch: () => {
				calls.push('reserve');
				return { kind: 'office' };
			},
			completeLaunch: (_reservation, url) => calls.push(`open:${url}`),
			cancelLaunch: vi.fn(),
		});
		expect(calls.slice(0, 4)).toEqual(['reserve', 'token', 'doc', 'room']);
		expect(calls[4]).toContain('?room=room_123');
		expect(result).toEqual({ sharedDoc: true });
	});

	it('launches a direct tool without reading the document or calling the backend', async () => {
		const getAccessToken = vi.fn();
		const getDocContext = vi.fn();
		const createRoom = vi.fn();
		const completeLaunch = vi.fn();
		const result = await launchFirstPartyTool(
			{
				...mindmap,
				id: 'direct',
				url: 'https://direct.example/',
				launchKind: 'direct',
			},
			{
				getAccessToken,
				getDocContext,
				createRoom,
				reserveLaunch: () => ({ kind: 'office' }),
				completeLaunch,
				cancelLaunch: vi.fn(),
			},
		);
		expect(getAccessToken).not.toHaveBeenCalled();
		expect(getDocContext).not.toHaveBeenCalled();
		expect(createRoom).not.toHaveBeenCalled();
		expect(completeLaunch).toHaveBeenCalledWith(
			{ kind: 'office' },
			'https://direct.example/',
		);
		expect(result).toEqual({ sharedDoc: false });
	});
});
