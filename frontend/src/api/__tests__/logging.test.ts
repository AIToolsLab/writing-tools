import { describe, expect, it, vi } from 'vitest';
import type { LogFn } from '@/hooks/useLog';
import { chatLog, draftLog, LOG_SCHEMA_VERSION, reviseLog } from '../logging';

// The page helpers stamp the envelope and forward to a LogFn (from useLog).
// Pass a mock LogFn and inspect the payload it receives — transport, identity,
// and consent are useLog's concern and tested there.
function makeLog() {
	return vi.fn<LogFn>().mockResolvedValue(undefined);
}

const docContext: DocContext = {
	beforeCursor: 'before',
	selectedText: '',
	afterCursor: 'after',
};

describe('event envelope', () => {
	it('stamps schema_version, page, and event on every event', () => {
		const log = makeLog();
		draftLog.suggestionRequested(log, {
			generationType: 'example_sentences',
			docContext,
		});

		expect(log).toHaveBeenCalledTimes(1);
		const payload = log.mock.calls[0][0];
		expect(payload.schema_version).toBe(LOG_SCHEMA_VERSION);
		expect(payload.page).toBe('draft');
		expect(payload.event).toBe('suggestion_requested');
		expect(payload.generationType).toBe('example_sentences');
		// Identity is added by useLog from the session, not here.
		expect(payload).not.toHaveProperty('username');
	});

	it('scopes events to the emitting page', () => {
		const log = makeLog();
		reviseLog.featuresRun(log, { features: ['Main Point'] });
		expect(log.mock.calls[0][0].page).toBe('revise');

		chatLog.messageSent(log, { message: 'hi', source: 'input' });
		expect(log.mock.calls[1][0].page).toBe('chat');
	});

	it('carries event-specific payload fields through unchanged', () => {
		const log = makeLog();
		chatLog.messageSent(log, {
			message: 'what is my thesis?',
			source: 'suggested',
		});
		const payload = log.mock.calls[0][0];
		expect(payload.event).toBe('message_sent');
		expect(payload.message).toBe('what is my thesis?');
		expect(payload.source).toBe('suggested');
	});
});
