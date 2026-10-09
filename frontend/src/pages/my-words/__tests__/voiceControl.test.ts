/**
 * The voice session's control invariants — the rules that decide whether the
 * writer feels like the conductor of edits. See the numbered list at the top of
 * `voice/session.ts`; each `describe` below is one of them.
 *
 * These are *sequencing* tests, a different class from the pure-function tests
 * in ops/corpus/spliceAdapter: they drive a whole model turn through the real
 * session against a `MockEditor`, using a fake transport in place of the spoken
 * channel. Nothing here mocks WebRTC or the Realtime event stream — that layer's
 * bugs have always been environment facts a mock reproduces wrongly, so it's
 * verified by hand instead (see the note in `voice/realtime.ts`).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCorpus } from '../corpus';
import { MockEditor } from '../demo/mockEditor';
import { startVoiceSession } from '../voice/session';
import type { VoiceTransport, VoiceTransportOptions } from '../voice/transport';

const SEED = [
	'I have been putting off writing this note for weeks.',
	'Every time I sit down, the words come out stiff and I delete them.',
];

/** A valid tightening: `newStr` is a contiguous run of the writer's own words. */
const TIGHTEN = {
	old_str: 'the words come out stiff and I delete them',
	new_str: 'the words come out stiff',
};
/** Same shape, but on paragraph 1, for a second independent edit. */
const TRIM = {
	old_str: 'putting off writing this note for weeks',
	new_str: 'putting off writing this note',
};

/**
 * Stands in for the spoken channel: captures what the session configured, lets a
 * test invoke a tool the way the model would, and lets it fire `onSpeechStart`.
 */
function fakeTransport() {
	let captured: VoiceTransportOptions | null = null;
	let stopped = false;
	const transport: VoiceTransport = (opts) => {
		captured = opts;
		return Promise.resolve({
			stop: () => {
				stopped = true;
			},
		});
	};
	const opts = () => {
		if (!captured) throw new Error('transport was never started');
		return captured;
	};
	return {
		transport,
		/** Invoke a tool as the model would; returns the string it would read. */
		call: (name: string, args: Record<string, unknown> = {}) => {
			const tool = opts().tools.find((t) => t.name === name);
			if (!tool) throw new Error(`no such tool: ${name}`);
			return Promise.resolve(tool.handler(args));
		},
		/** The writer starts speaking. */
		speak: () => opts().onSpeechStart?.(),
		wasStopped: () => stopped,
		options: opts,
	};
}

async function harness(seed: string[] = SEED, initialScratchpad = '') {
	const editor = new MockEditor(seed);
	let scratchpad = initialScratchpad;
	// Every notice ever raised, and separately the one currently on screen —
	// invariant 6 is about the difference between the two.
	const notices: string[] = [];
	let standingNotice: string | null = null;
	const toolLog: string[] = [];
	let reveal: { anchor?: string; cancel: () => void } | null = null;
	let undoState: { depth: number; description?: string } = { depth: 0 };
	const fake = fakeTransport();

	const session = await startVoiceSession({
		editor,
		corpus: async () =>
			buildCorpus({ docText: await editor.getDocText(), scratchpad }),
		scratchpad: {
			get: () => scratchpad,
			set: (text) => {
				scratchpad = text;
			},
		},
		audioEl: {} as HTMLAudioElement,
		onNotice: (t) => {
			standingNotice = t;
			if (t !== null) notices.push(t);
		},
		onTool: (t) => toolLog.push(t),
		onReveal: (info) => {
			reveal = info;
		},
		onUndoChange: (s) => {
			undoState = s;
		},
		transport: fake.transport,
	});

	return {
		editor,
		session,
		fake,
		notices,
		/** What the writer is looking at right now, if anything. */
		notice: (): string | null => standingNotice,
		toolLog,
		paragraphs: () => editor.snapshot().paragraphs,
		scratchpad: () => scratchpad,
		reveal: () => reveal,
		undoState: () => undoState,
	};
}

/** Run a tool call across its reveal beat (which uses real timers otherwise). */
async function callThroughBeat(
	call: Promise<string>,
	{ before = 0, during }: { before?: number; during?: () => void } = {},
) {
	if (during) {
		await vi.advanceTimersByTimeAsync(before);
		during();
	}
	// Longer than the longest reveal beat (1.8s for `move`).
	await vi.advanceTimersByTimeAsync(2500);
	return call;
}

beforeEach(() => {
	vi.useFakeTimers();
	return () => vi.useRealTimers();
});

describe('invariant 1: one applied edit per writer turn', () => {
	it('refuses a second edit, then allows one after the writer speaks', async () => {
		const h = await harness();

		const first = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
		);
		expect(first).toMatch(/^Applied/);
		const afterFirst = h.paragraphs();

		// Same turn: the model tries again.
		const second = await h.fake.call('str_replace', TRIM);
		expect(second).toMatch(/already made a move this turn/);
		expect(h.paragraphs()).toEqual(afterFirst);

		// The writer takes the floor — that is what releases the next move.
		h.fake.speak();
		const third = await callThroughBeat(h.fake.call('str_replace', TRIM));
		expect(third).toMatch(/^Applied/);
		expect(h.paragraphs()[0]).toBe(
			'I have been putting off writing this note.',
		);
	});

	it('does not spend the turn on a rejected edit', async () => {
		const h = await harness();

		const rejected = await h.fake.call('str_replace', {
			old_str: 'the words come out stiff',
			new_str: 'the words come out clunky',
		});
		expect(rejected).toMatch(/^REJECTED/);

		// No speech in between: the budget must still be there.
		const applied = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
		);
		expect(applied).toMatch(/^Applied/);
	});

	it('does not spend the turn on an edit the writer vetoed with the chip', async () => {
		const h = await harness();

		const vetoed = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
			{
				before: 200,
				during: () => h.reveal()?.cancel(),
			},
		);
		expect(vetoed).toMatch(/cancelled that edit/);
		expect(h.paragraphs()).toEqual(SEED);

		const applied = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
		);
		expect(applied).toMatch(/^Applied/);
	});
});

describe('invariant 2: speech during the veto window', () => {
	it('cancels the pending edit and leaves the document untouched', async () => {
		const h = await harness();

		const result = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
			{
				before: 200,
				during: () => h.fake.speak(),
			},
		);

		expect(result).toMatch(/cancelled that edit/);
		expect(result).toMatch(/Don't retry it/);
		expect(h.paragraphs()).toEqual(SEED);
	});

	it('does NOT affect the next edit when the writer speaks outside a window', async () => {
		// The regression this guards: implementing the veto as a "writer objected"
		// flag instead of calling the open window's cancel. A flag set here would
		// leak forward and silently kill the edit below — which in a real session
		// looks like the partner losing the ability to edit while you talk.
		const h = await harness();

		h.fake.speak();
		h.fake.speak();

		const result = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
		);
		expect(result).toMatch(/^Applied/);
		expect(h.paragraphs()[1]).toBe(
			'Every time I sit down, the words come out stiff.',
		);
	});
});

describe('invariant 3: no silent failure', () => {
	it('emits exactly one writer-visible notice on every failing path', async () => {
		const cases: {
			name: string;
			run: (h: Awaited<ReturnType<typeof harness>>) => Promise<string>;
			model: RegExp;
		}[] = [
			{
				name: 'word-bank rejection',
				run: (h) =>
					h.fake.call('str_replace', {
						old_str: 'the words come out stiff',
						new_str: 'the words come out clunky',
					}),
				model: /^REJECTED/,
			},
			{
				name: 'unusable arguments',
				run: (h) => h.fake.call('str_replace', { new_str: 'stiff' }),
				model: /Could not read that tool call/,
			},
			{
				name: 'edit that will not apply',
				run: (h) =>
					callThroughBeat(
						h.fake.call('str_replace', {
							old_str: 'a phrase that is not in the document',
							new_str: 'the words come out stiff',
						}),
					),
				model: /Could not apply that/,
			},
			{
				name: 'veto',
				run: (h) =>
					callThroughBeat(h.fake.call('str_replace', TIGHTEN), {
						before: 200,
						during: () => h.reveal()?.cancel(),
					}),
				model: /cancelled that edit/,
			},
			{
				name: 'highlight miss on the scratchpad',
				run: (h) =>
					h.fake.call('highlight', {
						phrase: 'nothing like this is written down',
						target: 'scratchpad',
					}),
				model: /Could not find/,
			},
		];

		for (const c of cases) {
			const h = await harness();
			const modelText = await c.run(h);
			expect(modelText, `model text for ${c.name}`).toMatch(c.model);
			expect(h.notices, `writer notices for ${c.name}`).toHaveLength(1);
			expect(
				h.notices[0].length,
				`notice text for ${c.name}`,
			).toBeGreaterThan(0);
		}
	});

	it('notices a stale undo instead of silently doing nothing', async () => {
		const h = await harness();
		await callThroughBeat(h.fake.call('str_replace', TIGHTEN));
		h.notices.length = 0;

		// The writer edits the same region by hand.
		await h.editor.applyEdit({
			type: 'str_replace',
			oldStr: 'the words come out stiff',
			newStr: 'the words felt wrong',
			paragraph: 2,
		});

		const report = await h.session.undo();
		expect(report).toMatch(/already been changed/);
		expect(h.notices).toHaveLength(1);
		expect(h.paragraphs()[1]).toContain('the words felt wrong');
	});
});

describe('invariant 4: undo', () => {
	it('restores the previous text and reports what it reverted', async () => {
		const h = await harness();
		await callThroughBeat(h.fake.call('str_replace', TIGHTEN));

		expect(h.undoState().depth).toBe(1);
		expect(h.undoState().description).toMatch(/come out stiff/);

		const report = await callThroughBeat(h.session.undo());
		expect(report).toMatch(/^Undid:/);
		expect(h.paragraphs()).toEqual(SEED);
		expect(h.undoState().depth).toBe(0);
	});

	it('has nothing to undo before the partner has edited', async () => {
		const h = await harness();
		expect(await h.session.undo()).toBe('Nothing to undo.');
	});
});

describe('invariant 5: highlighting is not an edit', () => {
	it('costs nothing against the one-edit-per-turn budget, before or after a move', async () => {
		const h = await harness();

		// Two highlights back to back, same turn, no writer speech in between.
		const first = await callThroughBeat(
			h.fake.call('highlight', { phrase: 'the words come out stiff' }),
		);
		expect(first).toBe('Highlighted.');
		const second = await callThroughBeat(
			h.fake.call('highlight', {
				phrase: 'putting off writing this note',
			}),
		);
		expect(second).toBe('Highlighted.');

		// The budget is still there for a real edit, same turn.
		const applied = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
		);
		expect(applied).toMatch(/^Applied/);

		// And highlighting still works after the turn's move is spent.
		const third = await callThroughBeat(
			h.fake.call('highlight', {
				phrase: 'putting off writing this note',
			}),
		);
		expect(third).toBe('Highlighted.');
	});

	it('works the same way on the scratchpad target', async () => {
		const h = await harness([], 'A note about the weeks.');
		await callThroughBeat(
			h.fake.call('highlight', {
				phrase: 'A note',
				target: 'scratchpad',
			}),
		);
		const second = await callThroughBeat(
			h.fake.call('highlight', {
				phrase: 'about the weeks',
				target: 'scratchpad',
			}),
		);
		expect(second).toBe('Highlighted on the scratchpad.');
	});

	it('takes a beat before the tool result returns', async () => {
		const h = await harness();
		let settled = false;
		const call = h.fake
			.call('highlight', { phrase: 'the words come out stiff' })
			.then((r) => {
				settled = true;
				return r;
			});

		await vi.advanceTimersByTimeAsync(499);
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(await call).toBe('Highlighted.');
		expect(settled).toBe(true);
	});

	it('is not cancelled by speech during its beat — there is nothing to veto', async () => {
		const h = await harness();

		const result = await callThroughBeat(
			h.fake.call('highlight', { phrase: 'the words come out stiff' }),
			{ before: 200, during: () => h.fake.speak() },
		);

		expect(result).toBe('Highlighted.');
		expect(h.notices).toHaveLength(0);
		// The writer's speech still opened a fresh edit budget, same as any speech.
		const applied = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
		);
		expect(applied).toMatch(/^Applied/);
	});
});

describe('invariant 6: a notice describes one attempt, not the session', () => {
	/** Raise a notice the honest way: an edit the word-bank refuses. */
	const provokeNotice = (h: Awaited<ReturnType<typeof harness>>) =>
		h.fake.call('str_replace', {
			old_str: 'the words come out stiff',
			new_str: 'the words come out clunky',
		});

	it('retracts the notice when the writer takes the floor again', async () => {
		const h = await harness();

		await provokeNotice(h);
		expect(h.notice()).toMatch(/clunky/);

		h.fake.speak();
		expect(h.notice()).toBeNull();
	});

	it('retracts the notice when an edit lands', async () => {
		const h = await harness();

		await provokeNotice(h);
		expect(h.notice()).not.toBeNull();

		// Same turn, no speech: the model corrects itself and the edit lands.
		const applied = await callThroughBeat(
			h.fake.call('str_replace', TIGHTEN),
		);
		expect(applied).toMatch(/^Applied/);
		expect(h.notice()).toBeNull();
	});

	it('retracts it for a scratchpad edit too', async () => {
		const h = await harness(SEED, 'stiff words I keep deleting');

		await provokeNotice(h);
		expect(h.notice()).not.toBeNull();

		const applied = await callThroughBeat(
			h.fake.call('str_replace', {
				old_str: 'stiff words',
				new_str: 'stiff',
				target: 'scratchpad',
			}),
		);
		expect(applied).toMatch(/^Applied/);
		expect(h.notice()).toBeNull();
	});

	it('keeps every notice in the log after retracting it from the strip', async () => {
		const h = await harness();

		await provokeNotice(h);
		h.fake.speak();

		// The strip is clear, but the history the writer can scroll back to is not
		// — retraction is a UI state change, not an erasure.
		expect(h.notice()).toBeNull();
		expect(h.notices).toHaveLength(1);
	});

	it('leaves a fresh notice standing until something supersedes it', async () => {
		const h = await harness();

		// A failure *after* the writer's turn started must survive the rest of
		// that turn — retraction keys on new events, not on elapsed time.
		h.fake.speak();
		await provokeNotice(h);
		await h.fake.call('view', {});
		await callThroughBeat(
			h.fake.call('highlight', { phrase: 'I sit down' }),
		);
		expect(h.notice()).toMatch(/clunky/);
	});
});

describe('session wiring', () => {
	it('exposes all six tools and stops the transport', async () => {
		const h = await harness();
		expect(h.fake.options().tools.map((t) => t.name)).toEqual([
			'view',
			'str_replace',
			'insert',
			'move',
			'highlight',
			'undo',
		]);
		await h.session.stop();
		expect(h.fake.wasStopped()).toBe(true);
	});

	it('reads the document through view, numbered for targeting', async () => {
		const h = await harness();
		const view = await h.fake.call('view', {});
		expect(view).toContain('[1]');
		expect(view).toContain('[2]');
	});
});
