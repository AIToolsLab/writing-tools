import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// scripts/log-viewer/analysis.js is a classic browser script that also exports
// via module.exports, so load it with require.
const require = createRequire(import.meta.url);
const A = require('../../scripts/log-viewer/analysis.js');

describe('techDifficulty', () => {
  const none = ['', 'No', 'no.', 'None', 'N/A', 'n/a', 'Nope', 'No issues detected', 'No technical difficulties.',
    'No, everything worked fine', "No, I didn't have any problems", 'Nothing', 'Not that I noticed', 'All good!'];
  for (const a of none) it(`"${a}" is not a report`, () => expect(A.techDifficulty(a).reported).toBe(false));

  const reported = ['The chat was slow to respond', 'No, but the AI panel froze once', 'Yes, the page reloaded',
    'Nothing major except some lag', 'I had to refresh the page', 'The AI suggestions kept changing while I was reading them'];
  for (const a of reported) it(`"${a}" is a report`, () => expect(A.techDifficulty(a).reported).toBe(true));
});

describe('screenFlags', () => {
  const meta = (w: number, h: number, sw = w, sh = h + 200) => ({ windowWidth: w, windowHeight: h, screenWidth: sw, screenHeight: sh, userAgent: 'Mozilla/5.0 (Macintosh)' });
  it('accepts a laptop-sized window', () => expect(A.screenFlags(meta(1728, 873), 'a')).toEqual([]));
  it('computes the email column from the task-page layout', () => {
    expect(A.emailColumnWidth(1440, true)).toBe(1440 - 1000);
    expect(A.emailColumnWidth(1440, false)).toBe(1440 - 540);
  });
  it('flags a window that leaves almost no room for the email (AI condition)', () => {
    expect(A.screenFlags(meta(1100, 800), 'a').map((f: { level: string }) => f.level)).toContain('bad');
  });
  it('does not flag the same window in the no-AI condition', () => {
    expect(A.screenFlags(meta(1100, 800), 'n')).toEqual([]);
  });
  it('notes zoomed-out browsers', () => {
    expect(A.screenFlags(meta(2000, 900, 1440, 900), 'a').map((f: { text: string }) => f.text)).toContain('Zoomed out');
  });
});

describe('overlap', () => {
  const colleague = { id: 'c1', kind: 'colleague', t: 10, text: 'Room 14 can take Jaden at 1:30pm tomorrow.' };
  const ai = { id: 'ai1', kind: 'ai', t: 20, text: 'We sincerely apologize for the inconvenience this causes you.' };
  const ai2 = { id: 'ai2', kind: 'ai', t: 25, text: 'Please let us know if the new time works for your schedule.' };

  it('credits pieces from several sources', () => {
    const email = 'Hi Jaden, Room 14 can take Jaden at 1:30pm. We sincerely apologize for the inconvenience. Please let us know if the new time works.';
    const r = A.overlap(email, [colleague, ai, ai2], [{ t: 30, text: email }], 4);
    expect(r.counts.colleague).toBe(8); // room 14 can take jaden at 1 30pm
    expect(r.counts.ai).toBe(6 + 9);
    expect(r.counts.none).toBe(2); // hi jaden
    expect(r.bySource.get('ai1')).toBe(6);
    expect(r.bySource.get('ai2')).toBe(9);
  });

  it('treats text the participant wrote before the AI repeated it as an echo', () => {
    const early = 'We sincerely apologize for the inconvenience';
    const r = A.overlap(early, [ai], [{ t: 5, text: early }], 4);
    expect(r.counts.ai).toBe(0);
    expect(r.counts.echo).toBe(6);
  });

  it('credits the earliest source when two contain the same words', () => {
    const r = A.overlap('Room 14 can take Jaden', [{ ...colleague, t: 10 }, { id: 'ai3', kind: 'ai', t: 5, text: 'Room 14 can take Jaden' }], [], 4);
    expect(r.counts.ai).toBe(5);
    expect(r.counts.colleague).toBe(0);
  });

  it('ignores runs shorter than n words', () => {
    const r = A.overlap('Room 14 is fine', [colleague], [], 4);
    expect(r.counts.none).toBe(4);
  });

  it('overlapRaw ignores timing', () => {
    expect(A.overlapRaw('We sincerely apologize for the inconvenience', [ai.text], 4)).toEqual({ total: 6, covered: 6 });
  });
});

describe('recallScore', () => {
  it('separates hits from false alarms on reverse-coded items', () => {
    const r = A.recallScore({
      specific_recall_a: A.RECALL_YES,
      specific_recall_b: "No, I don't remember considering this",
      specific_recall_lure: A.RECALL_YES,
      specific_recall_c: A.RECALL_UNSURE,
      tlx_effort: 'High',
    }, ['lure']);
    expect(r).toMatchObject({ nReal: 3, nLure: 1, hits: 1, falseAlarms: 1, unsure: 1 });
    expect(r.hitRate).toBeCloseTo(1 / 3);
    expect(r.faRate).toBe(1);
  });
});

describe('findQuote', () => {
  it('matches across whitespace, case and curly quotes', () => {
    const text = 'I think Jaden’s audience\nmight  be confused.';
    const at = A.findQuote(text, "jaden's audience might be");
    expect(at).not.toBeNull();
    expect(text.slice(at[0], at[1])).toBe('Jaden’s audience\nmight  be');
  });
  it('returns null for text that is not there', () => {
    expect(A.findQuote('abc def', 'xyz')).toBeNull();
  });
});
