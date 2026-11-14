// Rubric coding for log-viewer.html: the codebook (rubric items + survey
// scoring settings), an LLM first pass per participant, and views that
// highlight the quoted evidence in the participant's own text so you can check
// it and see what the rubric doesn't capture.
//
// Uses globals from log-viewer.html (h, answerText, rerenderAll), analysis.js
// (findQuote), study-materials.js (STUDY_MATERIALS) and default-codebook.js
// (DEFAULT_CODEBOOK). Everything is stored in this browser's localStorage.
'use strict';
window.Rubric = (() => {
  const LS_CODEBOOK = 'logViewer.codebook';
  const LS_RESULTS = 'logViewer.rubricResults';
  const LS_LLM = 'logViewer.llm';
  const DEFAULT_LLM = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-terra', token: '', reasoning: 'auto' };

  const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('localStorage write failed', e); } };

  let codebook = load(LS_CODEBOOK, null) || structuredClone(DEFAULT_CODEBOOK);
  let results = load(LS_RESULTS, {}); // username -> codebookHash -> record
  let llm = { ...DEFAULT_LLM, ...load(LS_LLM, {}) };
  const running = new Map(); // username -> 'running' | error message
  let batch = null; // { done, total, failed }

  // ---- Model list (GET <baseUrl>/models), for the Model field's autocomplete ----
  const modelList = Object.assign(document.createElement('datalist'), { id: 'llm-models' }); // not h(): it isn't defined yet when this file loads
  let models = { key: null, byId: new Map(), error: null }; // id -> /models entry
  function refreshModels() {
    const key = `${llm.baseUrl}\n${llm.token}`;
    if (models.key === key) return;
    models = { key, byId: new Map(), error: null };
    modelList.replaceChildren();
    fetch(llm.baseUrl.replace(/\/+$/, '') + '/models', { headers: llm.token ? { Authorization: `Bearer ${llm.token}` } : {} })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error?.message || ''}`);
        return data;
      })
      .then((data) => {
        if (models.key !== key) return; // settings changed while this was in flight
        const list = (data?.data || []).filter((m) => typeof m?.id === 'string').sort((a, b) => a.id.localeCompare(b.id));
        for (const m of list) models.byId.set(m.id, m);
        modelList.replaceChildren(...list.map((m) => h('option', { value: m.id })));
      })
      .catch((e) => { if (models.key === key) { models.error = String(e.message || e); console.warn('Could not list models', e); rerenderAll(); } });
  }

  // ---- Reasoning ----
  const REASONING = { default: 'Model default', off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };
  function effectiveReasoning() {
    return llm.reasoning || 'default';
  }
  function reasoningParams() {
    const r = effectiveReasoning();
    if (r === 'default') return {};
    return { reasoning_effort: r === 'off' ? 'none' : r };
  }

  // ---- Codebook ----
  function validate(cb) {
    const errs = [];
    if (!cb || typeof cb !== 'object') return ['Not a JSON object'];
    if (!Array.isArray(cb.items) || !cb.items.length) errs.push('`items` must be a non-empty array');
    if (!Array.isArray(cb.levels) || !cb.levels.length) errs.push('`levels` must be a non-empty array of { value, label }');
    const ids = new Set();
    for (const it of cb.items || []) {
      if (!it.id || !/^[A-Za-z0-9_-]+$/.test(it.id)) errs.push(`Item id ${JSON.stringify(it.id)} must be letters, digits, _ or -`);
      if (ids.has(it.id)) errs.push(`Duplicate item id ${it.id}`);
      ids.add(it.id);
      if (!it.label) errs.push(`Item ${it.id} needs a label`);
      if (it.scenarios && !Array.isArray(it.scenarios)) errs.push(`Item ${it.id}: scenarios must be an array of scenario ids`);
    }
    for (const lv of cb.levels || []) if (!Number.isInteger(lv.value) || !lv.label) errs.push('Each level needs an integer `value` and a `label`');
    return errs;
  }
  function setCodebook(cb) {
    const errs = validate(cb);
    if (errs.length) throw new Error(errs.join('\n'));
    cb.kind = 'log-viewer-codebook';
    codebook = cb;
    save(LS_CODEBOOK, cb);
    rerenderAll();
  }
  // Coding results are tied to the parts of the codebook the coder sees.
  function codebookHash(cb = codebook) {
    const s = JSON.stringify([cb.instructions, cb.levels, cb.items]);
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x.toString(16).padStart(8, '0');
  }
  const itemsFor = (scenario) => codebook.items.filter((it) => !it.scenarios || it.scenarios.includes(scenario));
  const reverseCoded = (scenario) => (codebook.reverseCodedRecall || {})[scenario] || [];

  // ---- What the participant wrote ----
  // Each source has an id the LLM cites and the viewer highlights.
  const SKIP_SURVEY = new Set(['technical_difficulties']);
  function questionsFor(p) {
    return STUDY_MATERIALS.scenarios[p.scenario]?.postTask || [];
  }
  function sources(p) {
    const out = [];
    p.taskChat.filter((m) => m.role === 'user').forEach((m, i) => out.push({ id: `chat${i + 1}`, kind: 'chat', label: `Chat message ${i + 1}`, text: m.content, msg: m }));
    const subject = p.finalSubject ?? p.docUpdates[p.docUpdates.length - 1]?.extra_data?.subject;
    if (subject) out.push({ id: 'subject', kind: 'email', label: 'Email subject', text: subject });
    if (p.draftText) out.push({ id: 'email', kind: 'email', label: p.taskComplete ? 'Email' : 'Email (last draft, not submitted)', text: p.draftText });
    const answers = p.postAnswers || {};
    const qs = questionsFor(p);
    for (const q of qs) {
      if (q.type !== 'text' || SKIP_SURVEY.has(q.id)) continue;
      const text = answerText(answers[q.id]).trim();
      if (text) out.push({ id: q.id, kind: 'survey', label: q.section + ': ' + q.id, question: q.text, text });
    }
    // Answers to questions we don't have materials for (renamed/older surveys)
    for (const [k, v] of Object.entries(answers)) {
      if (qs.some((q) => q.id === k) || SKIP_SURVEY.has(k) || k.endsWith('_other') || k.startsWith('specific_recall_') || k.startsWith('tlx_')) continue;
      const text = answerText(v).trim();
      if (text.length > 40 && typeof v === 'string') out.push({ id: k, kind: 'survey', label: `Survey: ${k}`, question: '(question text unknown)', text });
    }
    return out;
  }

  // ---- Prompt ----
  function buildRequest(p) {
    const srcs = sources(p);
    const items = itemsFor(p.scenario);
    const sc = STUDY_MATERIALS.scenarios[p.scenario];
    const chatIds = new Map(srcs.filter((s) => s.msg).map((s) => [s.msg, s.id]));
    const transcript = p.taskChat.map((m) => m.role === 'user'
      ? `[${chatIds.get(m)}] Participant: ${m.content}`
      : `(context) Colleague: ${m.content}`).join('\n');
    const lines = [];
    lines.push('# Scenario', sc ? `${sc.taskTitle}\n${sc.taskDescription}\n\nBackground (the participant only learned what the colleague told them):\n${sc.context}` : `(unknown scenario ${p.scenario})`);
    lines.push('', '# Chat with the colleague', 'Lines tagged [chatN] are the participant\'s and can be cited. Colleague lines are context only.', transcript || '(no messages)');
    const email = srcs.filter((s) => s.kind === 'email');
    lines.push('', '# The participant\'s email', ...email.map((s) => `[${s.id}]\n${s.text}`));
    lines.push('', '# Post-task survey answers', 'Each answer is preceded by the question the participant saw (context only; cite the answer, not the question).');
    for (const s of srcs.filter((x) => x.kind === 'survey')) lines.push('', `## [${s.id}]`, `Question: ${s.question}`, `Answer:\n${s.text}`);
    lines.push('', '# Rubric', 'Levels:', ...codebook.levels.map((l) => `- ${l.value} = ${l.label}${l.description ? `: ${l.description}` : ''}`), '', 'Items:', ...items.map((it) => `- ${it.id}: ${it.label}. ${it.description || ''}`));
    lines.push('', '# What to return',
      'For EVERY rubric item: the level, the evidence, and a one-sentence rationale. Evidence quotes must be copied exactly from the cited source (a clause or sentence; no paraphrase, no ellipses). Use an empty evidence list for level 0.',
      '`uncaptured`: things the participant considered (about the situation, the recipient, or the consequences) that no rubric item covers. Quote them exactly too.',
      '`rubricFeedback`: where the rubric was hard to apply to this participant: items that were ambiguous, overlapping, too broad or narrow, scenario-specific needs, or missing. Use itemId "" for general feedback. Be specific and suggest a fix.');
    const sourceIds = srcs.map((s) => s.id);
    const itemIds = items.map((it) => it.id);
    const quote = { type: 'object', additionalProperties: false, required: ['source', 'quote'], properties: { source: { type: 'string', enum: sourceIds }, quote: { type: 'string' } } };
    const schema = {
      type: 'object', additionalProperties: false, required: ['items', 'uncaptured', 'rubricFeedback'],
      properties: {
        items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'level', 'evidence', 'rationale'], properties: {
          id: { type: 'string', enum: itemIds }, level: { type: 'integer', enum: codebook.levels.map((l) => l.value) }, evidence: { type: 'array', items: quote }, rationale: { type: 'string' } } } },
        uncaptured: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['source', 'quote', 'note'], properties: { ...quote.properties, note: { type: 'string' } } } },
        rubricFeedback: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['itemId', 'issue', 'suggestion'], properties: {
          itemId: { type: 'string', enum: [...itemIds, ''] }, issue: { type: 'string' }, suggestion: { type: 'string' } } } },
      },
    };
    const system = 'You code research data from a study of how people write workplace emails with and without AI help. ' +
      'Participants chatted with a colleague to learn about a situation, wrote an email, then answered survey questions. ' +
      'You judge which aspects of the rhetorical situation the participant considered, citing their exact words.\n\n' + (codebook.instructions || '');
    return {
      body: { model: llm.model, messages: [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }],
        response_format: { type: 'json_schema', json_schema: { name: 'rubric_coding', strict: true, schema } },
        ...reasoningParams() },
      sourceIds, itemIds,
    };
  }

  async function code(p) {
    if (!sources(p).length) throw new Error('Nothing to code');
    const { body } = buildRequest(p);
    running.set(p.username, 'running');
    rerenderAll();
    try {
      const res = await fetch(llm.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(llm.token ? { Authorization: `Bearer ${llm.token}` } : {}) },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = null; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error?.message || text.slice(0, 300)}`);
      const msg = data?.choices?.[0]?.message;
      if (msg?.refusal) throw new Error(`Model refused: ${msg.refusal}`);
      if (msg?.content == null && (msg?.reasoning_content || msg?.reasoning)) {
        throw new Error('The answer came back as reasoning with no content. Set Reasoning to Off.');
      }
      const result = JSON.parse(msg?.content ?? 'null');
      if (!result?.items) throw new Error('Unexpected response: ' + text.slice(0, 300));
      const record = { result, model: data.model || llm.model, reasoning: effectiveReasoning(), codebookVersion: codebook.version, codebookHash: codebookHash(), at: new Date().toISOString(), usage: data.usage };
      results[p.username] = { ...(results[p.username] || {}), [record.codebookHash]: record };
      save(LS_RESULTS, results);
      running.delete(p.username);
    } catch (err) {
      running.set(p.username, String(err.message || err));
      throw err;
    } finally {
      rerenderAll();
    }
  }

  async function codeAll(ps, { recode = false } = {}) {
    const todo = ps.filter((p) => p.taskComplete && (recode || !current(p)));
    batch = { done: 0, total: todo.length, failed: 0 };
    rerenderAll();
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        try { await code(p); } catch { batch.failed++; }
        batch.done++;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    batch = null;
    rerenderAll();
  }

  // Result for the current codebook, else null
  const current = (p) => results[p.username]?.[codebookHash()] || null;
  // Most recent result for any codebook
  function latest(p) {
    const all = Object.values(results[p.username] || {});
    return all.sort((a, b) => b.at.localeCompare(a.at))[0] || null;
  }

  // ---- Highlighting ----
  // Ranges for one source: evidence (per item) and uncaptured quotes.
  function rangesFor(record, src) {
    const out = [], missing = [];
    if (!record) return { ranges: out, missing };
    for (const it of record.result.items) {
      for (const ev of it.evidence || []) {
        if (ev.source !== src.id) continue;
        const at = findQuote(src.text, ev.quote);
        if (at) out.push({ start: at[0], end: at[1], type: 'item', label: it.id, level: it.level });
        else missing.push({ ...ev, item: it.id });
      }
    }
    for (const u of record.result.uncaptured || []) {
      if (u.source !== src.id) continue;
      const at = findQuote(src.text, u.quote);
      if (at) out.push({ start: at[0], end: at[1], type: 'uncaptured', label: '?', note: u.note });
      else missing.push({ ...u, item: 'uncaptured' });
    }
    return { ranges: out, missing };
  }
  // Renders text with ranges marked; item ids appear as small tags where a range ends.
  function highlight(text, ranges) {
    const cuts = new Set([0, text.length]);
    for (const r of ranges) { cuts.add(r.start); cuts.add(r.end); }
    const pts = [...cuts].sort((a, b) => a - b);
    const nodes = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const cover = ranges.filter((r) => r.start <= a && r.end >= b);
      const seg = text.slice(a, b);
      if (!cover.length) nodes.push(seg);
      else {
        const items = cover.filter((r) => r.type === 'item');
        const cls = items.length ? 'hl-item' : 'hl-uncaptured';
        nodes.push(h('span', { class: cls, title: cover.map((r) => r.type === 'item' ? `${r.label} (level ${r.level})` : `not in rubric: ${r.note}`).join('\n') }, seg));
      }
      const ending = ranges.filter((r) => r.end === b);
      if (ending.length) nodes.push(h('sup', { class: 'hl-tag' }, [...new Set(ending.map((r) => r.label))].join(' ')));
    }
    return nodes;
  }
  function coverage(text, ranges) {
    const marked = new Array(text.length).fill(0); // 1 = item, 2 = uncaptured only
    for (const r of ranges) for (let i = r.start; i < r.end; i++) marked[i] = r.type === 'item' ? 1 : (marked[i] || 2);
    const nonSpace = [...text].map((c, i) => (/\s/.test(c) ? -1 : marked[i])).filter((v) => v >= 0);
    const n = nonSpace.length || 1;
    return { item: nonSpace.filter((v) => v === 1).length / n, uncaptured: nonSpace.filter((v) => v === 2).length / n };
  }
  const pct = (x) => `${Math.round(x * 100)}%`;

  // ---- Views ----
  function levelLabel(v) { return codebook.levels.find((l) => l.value === v)?.label ?? v; }

  function renderParticipant(p) {
    const wrap = h('div', {});
    const record = current(p) || latest(p);
    const stale = record && record.codebookHash !== codebookHash();
    const state = running.get(p.username);
    const srcs = sources(p);
    wrap.append(h('div', { class: 'rubric-bar' },
      h('button', { disabled: state === 'running' || !srcs.length, onclick: () => code(p).catch(() => {}) }, state === 'running' ? 'Coding…' : record ? (stale ? 'Re-code with current codebook' : 'Re-code') : 'Code with LLM'),
      h('span', { class: 'muted' }, `Sends this participant's chat, email and survey answers to ${llm.baseUrl} (${llm.model}).`),
      state && state !== 'running' ? h('span', { class: 'flag bad' }, state) : null,
    ));
    if (!record) {
      wrap.append(h('p', { class: 'muted' }, `Not coded yet. ${itemsFor(p.scenario).length} rubric items apply to ${p.scenario}.`));
      return wrap;
    }
    wrap.append(h('p', { class: stale ? 'flag warn' : 'muted' },
      `${stale ? 'STALE: coded with a different codebook. ' : ''}Codebook ${record.codebookVersion ?? '?'} (${record.codebookHash}) · ${record.model}${record.reasoning ? ` (reasoning ${record.reasoning})` : ''} · ${new Date(record.at).toLocaleString()}`));

    // Items
    const allMissing = [];
    const bySource = new Map(srcs.map((s) => [s.id, s]));
    const itemDefs = new Map(codebook.items.map((it) => [it.id, it]));
    wrap.append(h('table', { class: 'rubric-items' },
      h('thead', {}, h('tr', {}, ['Item', 'Level', 'Evidence', 'Rationale'].map((x) => h('th', {}, x)))),
      h('tbody', {}, record.result.items.map((it) => h('tr', {},
        h('td', { title: itemDefs.get(it.id)?.description || '' }, h('b', {}, it.id), h('br'), h('span', { class: 'muted' }, itemDefs.get(it.id)?.label || '(not in current codebook)')),
        h('td', { class: `lvl lvl-${it.level}` }, `${it.level} ${levelLabel(it.level)}`),
        h('td', {}, (it.evidence || []).map((ev) => {
          const src = bySource.get(ev.source);
          const ok = src && findQuote(src.text, ev.quote);
          return h('div', { class: 'ev' }, h('span', { class: 'src-chip' }, ev.source), ' ', ok ? `“${ev.quote}”` : h('span', { class: 'flag bad', title: 'Quote not found verbatim in that source' }, `⚠ “${ev.quote}”`));
        })),
        h('td', {}, it.rationale),
      )))));

    // Sources with highlights
    const srcBox = h('div', { class: 'rubric-sources' });
    for (const s of srcs) {
      const { ranges, missing } = rangesFor(record, s);
      allMissing.push(...missing.map((m) => ({ ...m, source: s.id })));
      const cov = coverage(s.text, ranges);
      srcBox.append(h('div', { class: 'rubric-source' },
        h('div', { class: 'src-head' }, h('span', { class: 'src-chip' }, s.id), ' ', s.label,
          h('span', { class: 'muted' }, ` · ${pct(cov.item)} coded, ${pct(cov.uncaptured)} flagged as not in rubric`)),
        s.question ? h('details', {}, h('summary', {}, 'Question'), h('div', { class: 'q-text' }, s.question)) : null,
        h('div', { class: 'src-text' }, highlight(s.text, ranges))));
    }
    wrap.append(h('h4', {}, 'Participant text with evidence highlighted'),
      h('div', { class: 'legend' }, h('span', { class: 'hl-item' }, 'cited as evidence'), h('span', { class: 'hl-uncaptured' }, 'considered, but no rubric item fits'), h('span', {}, 'plain = not cited')),
      srcBox);
    // Uncaptured sources with quotes not found anywhere
    for (const u of record.result.uncaptured || []) if (!bySource.has(u.source)) allMissing.push({ ...u, item: 'uncaptured' });

    if (record.result.uncaptured?.length) {
      wrap.append(h('h4', {}, 'Not captured by the rubric'), h('ul', {}, record.result.uncaptured.map((u) => h('li', {}, h('span', { class: 'src-chip' }, u.source), ` “${u.quote}” `, h('span', { class: 'muted' }, u.note)))));
    }
    if (record.result.rubricFeedback?.length) {
      wrap.append(h('h4', {}, 'Feedback on the rubric'), h('ul', {}, record.result.rubricFeedback.map((f) => h('li', {}, h('b', {}, f.itemId || 'general'), ': ', f.issue, h('br'), h('span', { class: 'muted' }, 'Suggestion: ', f.suggestion)))));
    }
    if (allMissing.length) {
      wrap.append(h('p', { class: 'flag warn' }, `${allMissing.length} quote(s) not found verbatim: ${allMissing.map((m) => `${m.item} in ${m.source}`).join(', ')}`));
    }
    return wrap;
  }

  // Settings: LLM endpoint, codebook editor, results import/export
  function renderSettings(ps) {
    refreshModels();
    const box = h('div', { class: 'panel settings' });
    const setLlm = (key, value) => { llm[key] = value; save(LS_LLM, llm); rerenderAll(); };
    const field = (label, key, attrs = {}) => h('label', { class: 'field' }, label, h('input', { value: llm[key], ...attrs, onchange: (e) => setLlm(key, e.target.value.trim()) }));
    const reasoning = llm.reasoning || 'default';
    const reasoningSelect = h('select', { onchange: (e) => setLlm('reasoning', e.target.value) },
      Object.entries(REASONING).map(([v, label]) => h('option', { value: v, selected: v === reasoning }, label)));
    box.append(h('h3', {}, 'LLM endpoint (OpenAI-compatible)'),
      h('div', { class: 'fields' },
        field('Base URL', 'baseUrl', { size: 48 }),
        field('Model', 'model', { size: 24, list: 'llm-models' }),
        h('label', { class: 'field' }, 'Reasoning', reasoningSelect),
        field('Token', 'token', { type: 'password', size: 24, placeholder: 'ANALYSIS_TOKEN or API key' })),
      modelList,
      h('p', { class: 'muted' }, 'The token is kept in this browser\'s localStorage. For study.thoughtful-ai.com it is the server\'s ANALYSIS_TOKEN; for api.openai.com/v1 or openrouter.ai/api/v1 it is an API key. ',
        'Model suggestions come from the server\'s /models list', models.error ? ` (unavailable: ${models.error})` : '', '. ',
        'Reasoning "Off" sends reasoning_effort "none" to OpenAI-style servers.'));

    const coded = ps.filter((p) => current(p)).length, eligible = ps.filter((p) => p.taskComplete).length;
    box.append(h('div', { class: 'rubric-bar' },
      h('button', { disabled: !!batch || !eligible, onclick: () => codeAll(ps) }, batch ? `Coding ${batch.done}/${batch.total}${batch.failed ? `, ${batch.failed} failed` : ''}…` : `Code ${eligible - coded} uncoded participant(s)`),
      h('button', { disabled: !!batch || !coded, onclick: () => { if (confirm(`Re-code all ${eligible} participants?`)) codeAll(ps, { recode: true }); } }, 'Re-code all'),
      h('span', { class: 'muted' }, `${coded}/${eligible} submitted participants coded with the current codebook`),
      h('button', { onclick: () => download(`rubric-results-${codebook.version || 'codebook'}.json`, { kind: 'log-viewer-rubric-results', results }) }, 'Export results'),
    ));

    const ta = h('textarea', { class: 'codebook-editor', rows: 22, spellcheck: 'false' });
    ta.value = JSON.stringify(codebook, null, 2);
    const msg = h('pre', { class: 'muted' });
    box.append(h('h3', {}, `Codebook: ${codebook.version || '(no version)'} · hash ${codebookHash()} · ${codebook.items.length} items`),
      h('p', { class: 'muted' }, 'Items with `scenarios` apply only there. `reverseCodedRecall` lists specific-recall items that were NOT part of the scenario (scored as false alarms). Coding results are kept per codebook hash, so editing items or instructions marks earlier results stale.'),
      ta,
      h('div', { class: 'rubric-bar' },
        h('button', { onclick: () => { try { setCodebook(JSON.parse(ta.value)); } catch (e) { msg.textContent = String(e.message || e); } } }, 'Apply'),
        h('button', { onclick: () => download(`codebook-${codebook.version || 'draft'}.json`, codebook) }, 'Save codebook'),
        h('label', { class: 'filebtn' }, 'Load codebook / results…', h('input', { type: 'file', accept: '.json', onchange: async (e) => { for (const f of e.target.files) importJson(JSON.parse(await f.text())); } })),
        h('button', { onclick: () => { if (confirm('Replace your codebook with the built-in default?')) setCodebook(structuredClone(DEFAULT_CODEBOOK)); } }, 'Reset to default'),
      ), msg);
    return box;
  }

  function download(name, obj) {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  // Accepts a codebook or exported results. Returns true if it recognized the JSON.
  function importJson(obj) {
    if (obj?.kind === 'log-viewer-codebook' || (obj?.items && obj?.levels)) { setCodebook(obj); return 'codebook'; }
    if (obj?.kind === 'log-viewer-rubric-results') {
      for (const [u, byHash] of Object.entries(obj.results || {})) results[u] = { ...(results[u] || {}), ...byHash };
      save(LS_RESULTS, results); rerenderAll(); return 'results';
    }
    return null;
  }

  return { get codebook() { return codebook; }, codebookHash, itemsFor, reverseCoded, sources, buildRequest, code, codeAll, current, latest, rangesFor, highlight, coverage, renderParticipant, renderSettings, importJson, levelLabel };
})();
