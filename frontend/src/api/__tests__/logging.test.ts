import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	chatLog,
	draftLog,
	LOG_SCHEMA_VERSION,
	reviseLog,
} from '../logging';

// The logging helpers ultimately call `log()` in ../index, which POSTs to
// `${SERVER_URL}/log` via fetch. Stub fetch and inspect the serialized body.
let fetchMock: ReturnType<typeof vi.fn>;

function lastBody(): Record<string, unknown> {
	const calls = fetchMock.mock.calls;
	const [, init] = calls[calls.length - 1]!;
	return JSON.parse((init as RequestInit).body as string);
}

const docContext: DocContext = {
	beforeCursor: 'before',
	selectedText: '',
	afterCursor: 'after',
};

beforeEach(() => {
	fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('event envelope', () => {
	it('stamps schema_version, page, event, and username on every event', () => {
		draftLog.suggestionRequested('alice', {
			generationType: 'example_sentences',
			docContext,
		});

		const body = lastBody();
		expect(body.schema_version).toBe(LOG_SCHEMA_VERSION);
		expect(body.page).toBe('draft');
		expect(body.event).toBe('suggestion_requested');
		expect(body.username).toBe('alice');
		expect(body.generationType).toBe('example_sentences');
		// The transport adds a timestamp.
		expect(typeof body.timestamp).toBe('number');
	});

	it('scopes events to the emitting page', () => {
		reviseLog.featuresRun('bob', { features: ['Main Point'] });
		expect(lastBody().page).toBe('revise');

		chatLog.messageSent('bob', { message: 'hi', source: 'input' });
		expect(lastBody().page).toBe('chat');
	});

	it('carries event-specific payload fields through unchanged', () => {
		chatLog.messageSent('carol', { message: 'what is my thesis?', source: 'suggested' });
		const body = lastBody();
		expect(body.event).toBe('message_sent');
		expect(body.message).toBe('what is my thesis?');
		expect(body.source).toBe('suggested');
	});
});
