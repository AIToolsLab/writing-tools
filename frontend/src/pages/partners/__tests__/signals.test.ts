import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SIGNAL_CONFIG,
	describeActivity,
	endsSentence,
	initialSignalState,
	observe,
	type SignalConfig,
	type SignalState,
} from '../signals';
import type { DocSnapshot, TriggerEvent } from '../types';

const CONFIG: SignalConfig = { ...DEFAULT_SIGNAL_CONFIG, cooldownMs: 0 };

function snap(
	at: number,
	beforeCursor: string,
	selectedText = '',
	afterCursor = '',
): DocSnapshot {
	return { at, beforeCursor, selectedText, afterCursor };
}

/** Feed a series of snapshots through the machine, collecting what fired. */
function run(
	snapshots: DocSnapshot[],
	config: SignalConfig = CONFIG,
): { state: SignalState; events: TriggerEvent[] } {
	let state = initialSignalState();
	const events: TriggerEvent[] = [];
	for (const snapshot of snapshots) {
		const result = observe(state, snapshot, config);
		state = result.state;
		if (result.event) events.push(result.event);
	}
	return { state, events };
}

describe('endsSentence', () => {
	it('accepts sentence-final punctuation, with closers and trailing space', () => {
		expect(endsSentence('It rained.')).toBe(true);
		expect(endsSentence('Did it?  ')).toBe(true);
		expect(endsSentence('"Stop!"')).toBe(true);
		expect(endsSentence('(so it goes.)')).toBe(true);
	});

	it('rejects mid-sentence positions', () => {
		expect(endsSentence('It rained')).toBe(false);
		expect(endsSentence('It rained, and')).toBe(false);
		expect(endsSentence('')).toBe(false);
	});

	it('has the abbreviation false positive documented in signals.ts', () => {
		// Not a bug to fix silently: over-firing only means the decision engine
		// gets asked, and it is free to decline.
		expect(endsSentence('e.g.')).toBe(true);
	});
});

describe('observe', () => {
	it('fires nothing on the first snapshot', () => {
		const { events } = run([snap(0, 'hello')]);
		expect(events).toEqual([]);
	});

	it('does not treat an untouched document as a pause', () => {
		// The writer has not started; sitting still is not a pause.
		const { events } = run([
			snap(0, 'existing text'),
			snap(1_000, 'existing text'),
			snap(20_000, 'existing text'),
		]);
		expect(events).toEqual([]);
	});

	it('fires a long pause once the writer stops after typing', () => {
		const { events } = run([
			snap(0, 'The '),
			snap(1_000, 'The claim'),
			snap(6_500, 'The claim'),
		]);
		expect(events.map((e) => e.trigger)).toEqual(['long-pause']);
		expect(events[0].at).toBe(6_500);
	});

	it('fires a long pause only once per quiet period', () => {
		const { events } = run([
			snap(0, 'a'),
			snap(1_000, 'ab'),
			snap(7_000, 'ab'),
			snap(8_000, 'ab'),
			snap(30_000, 'ab'),
		]);
		expect(events.map((e) => e.trigger)).toEqual(['long-pause']);
	});

	it('re-arms the pause after the writer resumes', () => {
		const { events } = run([
			snap(0, 'a'),
			snap(1_000, 'ab'),
			snap(7_000, 'ab'), // pause 1
			snap(8_000, 'abc'), // resumed
			snap(14_000, 'abc'), // pause 2
		]);
		expect(events.map((e) => e.trigger)).toEqual([
			'long-pause',
			'long-pause',
		]);
	});

	it('fires a sentence end after the short idle, not immediately', () => {
		const { events } = run([
			snap(0, 'It rained'),
			snap(500, 'It rained.'),
			// 500ms later: under the 1s idle, nothing yet.
			snap(1_000, 'It rained.'),
			snap(1_800, 'It rained.'),
		]);
		expect(events.map((e) => e.trigger)).toEqual(['sentence-end']);
		expect(events[0].at).toBe(1_800);
	});

	it('does not re-fire for the same finished sentence', () => {
		const { events } = run([
			snap(0, 'It rained'),
			snap(500, 'It rained.'),
			snap(1_800, 'It rained.'),
			snap(3_000, 'It rained.'),
		]);
		// The pause would fire later; restrict to sentence ends.
		expect(events.filter((e) => e.trigger === 'sentence-end')).toHaveLength(
			1,
		);
	});

	it('fires again for the next sentence', () => {
		const { events } = run([
			snap(0, 'One'),
			snap(500, 'One.'),
			snap(1_800, 'One.'),
			snap(2_500, 'One. Two.'),
			snap(4_000, 'One. Two.'),
		]);
		expect(
			events.filter((e) => e.trigger === 'sentence-end'),
		).toHaveLength(2);
	});

	it('fires a text selection once the selection is held still', () => {
		const { events } = run([
			snap(0, 'The claim is bold', '', ''),
			snap(1_000, 'The ', 'claim', ' is bold'),
			snap(3_000, 'The ', 'claim', ' is bold'),
			snap(6_500, 'The ', 'claim', ' is bold'),
		]);
		expect(events.map((e) => e.trigger)).toEqual(['text-selection']);
		expect(events[0].at).toBe(6_500);
	});

	it('does not fire for a selection that keeps changing', () => {
		const { events } = run([
			snap(0, 'The claim is bold'),
			snap(1_000, 'The ', 'claim', ' is bold'),
			snap(4_000, 'The ', 'claim is', ' bold'),
			snap(7_000, 'The ', 'claim is b', 'old'),
		]);
		expect(events).toEqual([]);
	});

	it('prefers selection over a pause when both are due', () => {
		// Nothing has moved for 6s, and a selection has been held for 6s.
		const { events } = run([
			snap(0, 'The claim'),
			snap(500, 'The claims'),
			snap(1_000, 'The ', 'claims', ''),
			snap(8_000, 'The ', 'claims', ''),
		]);
		expect(events.map((e) => e.trigger)).toEqual(['text-selection']);
	});

	it('suppresses a second trigger inside the cooldown', () => {
		const withCooldown: SignalConfig = { ...CONFIG, cooldownMs: 30_000 };
		const { events } = run(
			[
				snap(0, 'a'),
				snap(500, 'a.'),
				snap(2_000, 'a.'), // sentence end fires
				snap(3_000, 'a. b'),
				snap(4_000, 'a. b.'),
				snap(6_000, 'a. b.'), // would fire, but inside cooldown
			],
			withCooldown,
		);
		expect(events.map((e) => e.trigger)).toEqual(['sentence-end']);
	});

	it('keeps only the activity inside the window', () => {
		const { state } = run([
			snap(0, 'a'),
			snap(1_000, 'ab'),
			snap(2_000, 'abc'),
			snap(19_000, 'abcd'),
		]);
		// The 1s and 2s records are older than the 15s window at t=19s.
		expect(state.activity.map((a) => a.at)).toEqual([19_000]);
	});

	it('classifies insertions, deletions and cursor movement', () => {
		const { state } = run([
			snap(0, 'abc'),
			snap(100, 'abcd'),
			snap(200, 'abc'),
			snap(300, 'ab', '', 'c'),
		]);
		expect(state.activity.map((a) => a.kind)).toEqual([
			'typed',
			'deleted',
			'moved',
		]);
	});

	it('records a same-length replacement as a revision', () => {
		const { state } = run([snap(0, 'cat'), snap(100, 'dog')]);
		expect(state.activity.map((a) => a.kind)).toEqual(['revised']);
	});
});

describe('describeActivity', () => {
	it('says so plainly when nothing happened', () => {
		expect(describeActivity([], 1_000)).toMatch(/No editing activity/);
	});

	it('summarises additions, deletions and recency', () => {
		const text = describeActivity(
			[
				{ at: 0, kind: 'typed', charsDelta: 40, cursor: 40 },
				{ at: 1_000, kind: 'deleted', charsDelta: -5, cursor: 35 },
			],
			3_000,
		);
		expect(text).toContain('40 characters added');
		expect(text).toContain('5 deleted');
		expect(text).toContain('2 seconds ago');
	});
});
