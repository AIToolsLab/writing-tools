// Pure analysis helpers for log-viewer.html. No DOM access, so they can be
// unit-tested in Node (see __tests__/scripts/logViewerAnalysis.test.ts).
// Loaded as a classic script: in the browser the exports become globals.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(this, function () {
  'use strict';

  // ---- Technical difficulties answer ----
  // The question is optional free text, so "No issues detected" and "none" are
  // common answers that mean "no difficulties". Treat a short answer that starts
  // with a negation and has no contrast or problem words as "none reported".
  const NEGATION_START = /^(no|nope|none|nothing|nah|n\/?a|na|not|zero|nil|all good|everything (was|went|worked)|it (was|went|worked) (fine|well|smoothly)|worked (fine|well))\b/;
  // Contrast words, or problem words a negative answer wouldn't need. Kept
  // narrow: "No, I didn't have any problems" must still read as negative.
  const PROBLEM_WORDS = /\b(but|except|although|though|however|until|slow|lag|crash|froze|freez|stuck|error|bug|glitch|broke|refresh|reload|disconnect|delay|weird|strange|unable)/;
  function techDifficulty(answer) {
    const text = (answer == null ? '' : String(answer)).trim();
    if (!text) return { reported: false, text, reason: 'blank' };
    const norm = text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
    const nWords = norm.split(' ').length;
    if (NEGATION_START.test(norm) && !PROBLEM_WORDS.test(norm) && nWords <= 12) {
      return { reported: false, text, reason: 'negative answer' };
    }
    return { reported: true, text, reason: '' };
  }

  // ---- Screen size ----
  // Task page layout (components/study/TaskPage.tsx): p-10 padding (40px each
  // side), chat sidebar w-110 (440px), AI sidebar w-110 (440px, not shown in
  // no_ai), gap-5 (20px) between panels. The email column is flex-1 with a 0
  // basis, so it only gets what the sidebars leave over.
  const LAYOUT = { padding: 80, sidebar: 440, gap: 20 };
  function emailColumnWidth(windowWidth, hasAiPanel) {
    const fixed = LAYOUT.padding + LAYOUT.sidebar + LAYOUT.gap + (hasAiPanel ? LAYOUT.sidebar + LAYOUT.gap : 0);
    return windowWidth - fixed;
  }
  const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;
  // Returns flags ({ level, text, detail }) for a "Started Study" browser-metadata
  // payload. Sizes are as logged when the study started; resizes later aren't logged.
  function screenFlags(meta, conditionCode) {
    const flags = [];
    if (!meta || meta.windowWidth == null) return flags;
    const hasAi = conditionCode !== 'n';
    const w = meta.windowWidth, hgt = meta.windowHeight;
    const col = emailColumnWidth(w, hasAi);
    const size = `window ${w}×${hgt}, screen ${meta.screenWidth}×${meta.screenHeight}`;
    if (col < 250) flags.push({ level: 'bad', text: `Email column ≈${Math.max(0, col)}px`, detail: `${size}. Task page sidebars take ${w - col}px${hasAi ? '' : ' (no AI panel)'}.` });
    else if (col < 450) flags.push({ level: 'warn', text: `Narrow email column ≈${col}px`, detail: `${size}. Task page sidebars take ${w - col}px${hasAi ? '' : ' (no AI panel)'}.` });
    if (hgt < 600) flags.push({ level: 'warn', text: `Short window (${hgt}px)`, detail: size });
    if (meta.screenWidth && w > meta.screenWidth * 1.05) flags.push({ level: 'info', text: 'Zoomed out', detail: `${size}: window wider than the screen means browser zoom below 100%` });
    else if (meta.screenWidth && w < meta.screenWidth * 0.6) flags.push({ level: 'info', text: 'Window much smaller than screen', detail: `${size}: small window or zoomed in` });
    if (MOBILE_UA.test(meta.userAgent || '')) flags.push({ level: 'bad', text: 'Mobile user agent', detail: meta.userAgent });
    return flags;
  }

  // ---- Text overlap ----
  // Words are lowercased with punctuation dropped, so "1:30pm," matches "1 30pm".
  function tokenize(text) {
    const out = [];
    const re = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
    let m;
    while ((m = re.exec(text || ''))) out.push({ w: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
    return out;
  }
  const normWords = (text) => tokenize(text).map((t) => t.w);

  // Which words of the email also occur in source texts, as runs of at least n
  // words? Each n-word window ("shingle") of the email is looked up in every
  // source, so an email stitched from several suggestions and messages is still
  // matched piece by piece.
  //
  // Direction: the AI sees the current draft and the chat, so its suggestions
  // often repeat the participant's own words. A shingle is credited to a source
  // only if the earliest source containing it came before the shingle first
  // appeared in any document snapshot. Otherwise it is an "echo": the source
  // repeated what the participant had already written.
  //
  // emailText: final email body
  // sources: [{ id, kind: 'ai'|'colleague'|'self', t, text }]
  // snapshots: [{ t, text }] document snapshots (any order)
  function overlap(emailText, sources, snapshots, n = 4) {
    const tokens = tokenize(emailText);
    const words = tokens.map((t) => t.w);
    const index = new Map(); // shingle -> Set of source indexes
    sources.forEach((src, si) => {
      const ws = normWords(src.text);
      for (let i = 0; i + n <= ws.length; i++) {
        const g = ws.slice(i, i + n).join(' ');
        if (!index.has(g)) index.set(g, new Set());
        index.get(g).add(si);
      }
    });
    const snaps = (snapshots || []).map((s) => ({ t: s.t, str: ' ' + normWords(s.text).join(' ') + ' ' })).sort((a, b) => a.t - b.t);
    const firstDocCache = new Map();
    const firstInDoc = (g) => {
      if (!firstDocCache.has(g)) {
        const hit = snaps.find((s) => s.str.includes(' ' + g + ' '));
        firstDocCache.set(g, hit ? hit.t : Infinity);
      }
      return firstDocCache.get(g);
    };

    // Per-token best attribution
    const attr = tokens.map(() => ({ kind: null, t: Infinity, sources: new Set(), echoSources: new Set() }));
    for (let i = 0; i + n <= words.length; i++) {
      const srcIdx = index.get(words.slice(i, i + n).join(' '));
      if (!srcIdx) continue;
      const docT = firstInDoc(words.slice(i, i + n).join(' '));
      let best = null;
      for (const si of srcIdx) {
        const src = sources[si];
        if (src.t < docT && (!best || src.t < best.t)) best = src;
      }
      for (let k = i; k < i + n; k++) {
        const a = attr[k];
        if (best) {
          if (best.t < a.t) { a.kind = best.kind; a.t = best.t; }
          for (const si of srcIdx) if (sources[si].t < docT) a.sources.add(sources[si].id);
        } else {
          for (const si of srcIdx) a.echoSources.add(sources[si].id);
          if (!a.kind) a.kind = 'echo';
        }
      }
    }
    const counts = { ai: 0, colleague: 0, self: 0, echo: 0, none: 0 };
    const bySource = new Map();
    attr.forEach((a) => {
      counts[a.kind || 'none']++;
      if (a.kind && a.kind !== 'echo') {
        // credit the earliest source(s) of that kind
        for (const id of a.sources) bySource.set(id, (bySource.get(id) || 0) + 1);
      }
    });
    // Merge into spans over the original text for highlighting
    const spans = [];
    tokens.forEach((tok, i) => {
      const a = attr[i];
      const kind = a.kind || 'none';
      const last = spans[spans.length - 1];
      if (last && last.kind === kind) {
        last.end = tok.end;
        for (const s of a.sources) last.sources.add(s);
        for (const s of a.echoSources) last.sources.add(s);
      } else {
        spans.push({ kind, start: tok.start, end: tok.end, sources: new Set([...a.sources, ...a.echoSources]) });
      }
    });
    return { n, total: tokens.length, counts, bySource, spans, tokens, attr };
  }

  // Fraction of email words covered by any n-word run from the sources, with no
  // timing check. Used for the chance baseline (no-AI emails vs. AI text that
  // other participants saw), so compare it with overlapRaw for AI participants.
  function overlapRaw(emailText, sourceTexts, n = 4) {
    const words = normWords(emailText);
    const grams = new Set();
    for (const text of sourceTexts) {
      const ws = normWords(text);
      for (let i = 0; i + n <= ws.length; i++) grams.add(ws.slice(i, i + n).join(' '));
    }
    const covered = new Array(words.length).fill(false);
    for (let i = 0; i + n <= words.length; i++) {
      if (grams.has(words.slice(i, i + n).join(' '))) for (let k = i; k < i + n; k++) covered[k] = true;
    }
    return { total: words.length, covered: covered.filter(Boolean).length };
  }

  // ---- Specific recall ----
  const RECALL_YES = 'Yes, I remember considering this';
  const RECALL_UNSURE = "I'm not sure";
  // Hits: "yes" on items that were part of the situation. False alarms: "yes" on
  // reverse-coded (lure) items that weren't. "Not sure" counts as neither.
  function recallScore(answers, reverseCoded) {
    const lures = new Set(reverseCoded || []);
    const r = { nReal: 0, nLure: 0, hits: 0, falseAlarms: 0, unsure: 0 };
    for (const [k, v] of Object.entries(answers || {})) {
      if (!k.startsWith('specific_recall_')) continue;
      const key = k.slice('specific_recall_'.length);
      const lure = lures.has(key);
      if (lure) r.nLure++; else r.nReal++;
      if (v === RECALL_YES) { if (lure) r.falseAlarms++; else r.hits++; }
      else if (v === RECALL_UNSURE) r.unsure++;
    }
    r.hitRate = r.nReal ? r.hits / r.nReal : NaN;
    r.faRate = r.nLure ? r.falseAlarms / r.nLure : NaN;
    return r;
  }

  // ---- Small stats ----
  function describe(values) {
    const xs = values.filter((v) => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b);
    const n = xs.length;
    if (!n) return { n: 0, mean: NaN, sd: NaN, median: NaN };
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
    const median = n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
    return { n, mean, sd, median };
  }

  // ---- Quote location (for checking LLM evidence against the source text) ----
  // Finds `quote` in `text` ignoring case, whitespace runs, and curly vs straight
  // quotes. Returns [start, end) offsets in the original text, or null.
  function findQuote(text, quote) {
    if (!text || !quote) return null;
    const norm = (c) => c.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').toLowerCase();
    let ns = '', map = [];
    let prevSpace = true;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (/\s/.test(c)) { if (!prevSpace) { ns += ' '; map.push(i); } prevSpace = true; continue; }
      ns += norm(c); map.push(i); prevSpace = false;
    }
    const q = norm(quote.replace(/\s+/g, ' ').trim()).replace(/^["']|["']$/g, '').replace(/(\.\.\.|…)$/, '').trim();
    if (!q) return null;
    const at = ns.indexOf(q);
    if (at < 0) return null;
    return [map[at], map[at + q.length - 1] + 1];
  }

  return { techDifficulty, emailColumnWidth, screenFlags, tokenize, overlap, overlapRaw, recallScore, describe, findQuote, RECALL_YES, RECALL_UNSURE };
});
