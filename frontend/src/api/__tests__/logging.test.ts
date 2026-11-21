import { describe, expect, it, vi } from 'vitest';
import type { LogFn } from '@/hooks/useLog';
import { filterBucketsForConsent } from '@/consent';
import {
	chatLog,
	draftLog,
	LOG_SCHEMA_VERSION,
	referenceLog,
	reviseLog,
} from '../logging';

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
		expect(payload.usage).toEqual({ generationType: 'example_sentences' });
		expect(payload.document).toEqual({ docContext });
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

	it("puts the writer's text in document and metadata in usage", () => {
		const log = makeLog();
		chatLog.messageSent(log, {
			message: 'what is my thesis?',
			source: 'suggested',
		});
		const payload = log.mock.calls[0][0];
		expect(payload.event).toBe('message_sent');
		expect(payload.document).toEqual({ message: 'what is my thesis?' });
		expect(payload.usage).toEqual({ source: 'suggested' });
	});

	it('puts AI output in ai_output', () => {
		const log = makeLog();
		reviseLog.visualizationCompleted(log, {
			feature: 'Main Point',
			response: 'AI text',
		});
		const payload = log.mock.calls[0][0];
		expect(payload.ai_output).toEqual({ response: 'AI text' });
		expect(payload.usage).toEqual({ feature: 'Main Point' });
	});
});

describe('consent buckets', () => {
	// Every helper, with a recognizable string in each text-bearing field. At
	// `usage`, none of those strings may appear in what useLog would send.
	const SECRET = 'SECRET-WRITER-TEXT';
	const secretContext: DocContext = {
		beforeCursor: SECRET,
		selectedText: SECRET,
		afterCursor: SECRET,
	};
	const result = {
		generation_type: 'g',
		result: SECRET,
	} as unknown as GenerationResult;

	function everyEvent(log: LogFn) {
		draftLog.suggestionRequested(log, {
			generationType: 'g',
			docContext: secretContext,
		});
		draftLog.suggestionShown(log, {
			generationType: 'g',
			docContext: secretContext,
			result,
		});
		draftLog.suggestionDeleted(log, {
			generationType: 'g',
			docContext: secretContext,
			result,
		});
		draftLog.suggestionEmpty(log, {
			generationType: 'g',
			docContext: secretContext,
		});
		draftLog.generationError(log, {
			generationType: 'g',
			docContext: secretContext,
			error: 'e',
		});
		draftLog.autoRefresh(log, {
			generationType: 'g',
			docContext: secretContext,
		});
		reviseLog.visualizationRequested(log, {
			feature: 'f',
			isOverall: true,
			docContext: secretContext,
		});
		reviseLog.visualizationCompleted(log, {
			feature: 'f',
			response: SECRET,
		});
		chatLog.messageSent(log, { message: SECRET, source: 'input' });
		chatLog.edit(log, 'proposed', {
			tool: 't',
			kind: 'k',
			toolCallId: 'c',
			proposal: { text: SECRET },
			offending: SECRET,
		});
		referenceLog.clicked(log, 'chat', { target: SECRET });
		referenceLog.resolved(log, 'revise', {
			target: SECRET,
			found: true,
			attempts: 1,
			durationMs: 5,
		});
	}

	it('keeps every text-bearing field out of the usage bucket', () => {
		const log = makeLog();
		everyEvent(log);
		for (const [payload] of log.mock.calls) {
			const { allowed, buckets } = filterBucketsForConsent(
				payload,
				'usage',
			);
			expect(allowed).toBe(true);
			expect(JSON.stringify(buckets), payload.event).not.toContain(
				SECRET,
			);
		}
	});

	it('drops only document text at ai_output', () => {
		const log = makeLog();
		everyEvent(log);
		for (const [payload] of log.mock.calls) {
			const { buckets } = filterBucketsForConsent(payload, 'ai_output');
			expect(buckets).not.toHaveProperty('document');
		}
	});
});
