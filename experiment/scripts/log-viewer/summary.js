// Cross-participant summary for log-viewer.html: quantitative measures by
// condition (the primary analysis) or by scenario (to spot an unusual
// scenario), specific-recall scoring, and free-text answers side by side.
// Uses globals from log-viewer.html (h, select, answerText, CONDITIONS,
// rerenderAll), analysis.js, study-materials.js and rubric.js.
'use strict';
window.Summary = (() => {
  let groupBy = 'condition';
  let qualQuestion = 'general_recall';

  const SCALES = {
    effort: ['Very Low', 'Low', 'Medium', 'High', 'Very High'],
    performance: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'],
    agree: ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'],
  };
  const scaleValue = (scale, v) => { const i = SCALES[scale].indexOf(v); return i < 0 ? NaN : i + 1; };
  const surveyItem = (id, label, scale) => ({ label, scale, get: (p) => p.postAnswers ? scaleValue(scale, p.postAnswers[id]) : NaN, raw: (p) => p.postAnswers?.[id] });

  function metricRows(ps) {
    const pctOf = (kind) => (p) => p.overlap && p.overlap.total ? (100 * p.overlap.counts[kind]) / p.overlap.total : NaN;
    const rows = [
      { section: 'Behavior (submitted only)' },
      { label: 'Task time (min)', get: (p) => p.taskMs / 60000, digits: 1 },
      { label: 'Chat messages sent', get: (p) => p.taskComplete ? p.taskChat.filter((m) => m.role === 'user').length : NaN },
      { label: 'Email words', get: (p) => p.taskComplete ? p.words : NaN },
      { label: 'AI suggestions shown', get: (p) => p.taskComplete ? p.aiResponses.length : NaN },
      { label: '% email words from AI', get: pctOf('ai'), title: 'First appeared in an AI suggestion, then in the draft (runs of ≥ n words)' },
      { label: '% email words from colleague', get: pctOf('colleague') },
      { label: '% email words echoed by a source', get: pctOf('echo'), title: 'Participant wrote it first; an AI suggestion or message later repeated it' },
      { section: 'Specific recall', note: 'Hit = "yes" on an item that was in the scenario. False alarm = "yes" on a reverse-coded item (see codebook).' },
      { label: 'Recall hit rate', get: (p) => p.recall?.hitRate, digits: 2 },
      { label: 'Recall false-alarm rate', get: (p) => p.recall?.faRate, digits: 2 },
      { section: 'Task load (1 = Very Low … 5 = Very High; performance 1 = Very poor … 5 = Excellent)' },
      surveyItem('tlx_mental_demand', 'Mental demand', 'effort'),
      surveyItem('tlx_temporal_demand', 'Time pressure', 'effort'),
      surveyItem('tlx_performance', 'Self-rated performance', 'performance'),
      surveyItem('tlx_physical_demand', 'Physical demand', 'effort'),
      surveyItem('tlx_effort', 'Effort', 'effort'),
      surveyItem('tlx_frustration', 'Frustration', 'effort'),
      { section: 'About the AI (AI conditions; 1 = Strongly Disagree … 5 = Strongly Agree)' },
      surveyItem('ai_ease_understand', 'Easy to understand', 'agree'),
      surveyItem('ai_helpful', 'Helpful', 'agree'),
      surveyItem('ai_felt_pressured', 'Felt pressured to use it', 'agree'),
      surveyItem('ai_think_carefully', 'Had to think carefully about using it', 'agree'),
    ];
    const coded = ps.filter((p) => Rubric.current(p));
    if (coded.length) {
      rows.push({ section: `Rubric levels (current codebook; ${coded.length} coded)` });
      for (const it of Rubric.codebook.items) {
        rows.push({ label: it.label, title: `${it.id}${it.scenarios ? ` (${it.scenarios.join(', ')})` : ''}: ${it.description || ''}`, digits: 2,
          get: (p) => { const r = Rubric.current(p)?.result.items.find((x) => x.id === it.id); return r ? r.level : NaN; } });
      }
    }
    return rows;
  }

  const groupOf = (p) => groupBy === 'condition' ? (p.conditionCode ?? '?') : p.scenario;
  const groupLabel = (g) => groupBy === 'condition' ? `${g} · ${CONDITIONS[g] || g}` : g;
  const fmt = (x, d = 1) => isFinite(x) ? x.toFixed(d) : '–';

  function renderTable(ps) {
    const groups = [...new Set(ps.map(groupOf))].sort();
    const rows = metricRows(ps);
    const thead = h('thead', {}, h('tr', {}, h('th', {}, 'Measure'), groups.map((g) => h('th', {}, groupLabel(g), h('div', { class: 'muted' }, `n=${ps.filter((p) => groupOf(p) === g).length}`))), h('th', {}, 'All', h('div', { class: 'muted' }, `n=${ps.length}`))));
    const tbody = h('tbody');
    for (const row of rows) {
      if (row.section) { tbody.append(h('tr', { class: 'section-row' }, h('td', { colspan: groups.length + 2 }, row.section, row.note ? h('span', { class: 'muted' }, ' ' + row.note) : null))); continue; }
      const all = describe(ps.map(row.get));
      if (!all.n) continue;
      const cell = (sub) => {
        const d = describe(sub.map(row.get));
        if (!d.n) return h('td', { class: 'num muted' }, '–');
        let cls = 'num', title = `n=${d.n}, median ${fmt(d.median, row.digits ?? 1)}${isFinite(d.sd) ? `, sd ${fmt(d.sd, 2)}` : ''}`;
        if (row.raw) {
          const counts = SCALES[row.scale].map((lbl) => `${lbl}: ${sub.filter((p) => row.raw(p) === lbl).length}`);
          title += '\n' + counts.join('\n');
        }
        // In scenario view, mark groups far from everyone else
        if (groupBy === 'scenario' && sub !== ps && d.n >= 2 && all.sd > 0) {
          const z = (d.mean - all.mean) / all.sd;
          if (Math.abs(z) >= 1) { cls += ' unusual'; title += `\n${z > 0 ? 'Above' : 'Below'} the overall mean by ${Math.abs(z).toFixed(1)} sd`; }
        }
        return h('td', { class: cls, title }, fmt(d.mean, row.digits ?? 1), h('span', { class: 'muted small' }, ` (${d.n})`));
      };
      tbody.append(h('tr', {}, h('td', { title: row.title || '' }, row.label), groups.map((g) => cell(ps.filter((p) => groupOf(p) === g))), cell(ps)));
    }
    return h('div', { class: 'table-wrap tall' }, h('table', { class: 'summary-table' }, thead, tbody));
  }

  // Chance baseline: how much of a no-AI email is covered by AI text that
  // others in the same scenario saw, vs. the same raw measure for AI participants.
  function renderBaseline(ps, n) {
    const byScenario = new Map();
    for (const p of ps) {
      if (!p.taskComplete) continue;
      if (!byScenario.has(p.scenario)) byScenario.set(p.scenario, []);
      byScenario.get(p.scenario).push(p);
    }
    const rows = [];
    for (const [sc, group] of byScenario) {
      const noAi = group.filter((p) => p.conditionCode === 'n');
      const withAi = group.filter((p) => p.conditionCode !== 'n' && p.aiResponses.length);
      const others = (p) => withAi.filter((q) => q !== p).flatMap((q) => q.aiResponses.map((e) => e.extra_data?.generation?.result || ''));
      const rawPct = (p, texts) => { const r = overlapRaw(p.draftText, texts, n); return r.total ? (100 * r.covered) / r.total : NaN; };
      const base = describe(noAi.map((p) => rawPct(p, others(p))));
      const own = describe(withAi.map((p) => rawPct(p, p.aiResponses.map((e) => e.extra_data?.generation?.result || ''))));
      rows.push(h('tr', {}, h('td', {}, sc), h('td', { class: 'num' }, base.n ? `${fmt(base.mean)}%` : '–', h('span', { class: 'muted small' }, ` (${base.n})`)), h('td', { class: 'num' }, own.n ? `${fmt(own.mean)}%` : '–', h('span', { class: 'muted small' }, ` (${own.n})`))));
    }
    return h('div', {},
      h('p', { class: 'muted' }, `Raw overlap (any ${n}-word run, ignoring who wrote it first). The no-AI column is a chance baseline: stock phrases and shared facts match without any copying.`),
      h('table', { class: 'summary-table narrow' }, h('thead', {}, h('tr', {}, ['Scenario', 'No-AI emails vs. others\' AI text', 'AI participants vs. their own AI text'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)));
  }

  function renderRecall(ps) {
    const out = h('div', {});
    const scenarios = [...new Set(ps.filter((p) => p.postAnswers).map((p) => p.scenario))].sort();
    for (const sc of scenarios) {
      const group = ps.filter((p) => p.scenario === sc && p.postAnswers);
      const items = (STUDY_MATERIALS.scenarios[sc]?.postTask || []).filter((q) => q.id.startsWith('specific_recall_'));
      const lures = new Set(Rubric.reverseCoded(sc));
      const conds = [...new Set(group.map((p) => p.conditionCode ?? '?'))].sort();
      out.append(h('h4', {}, `${sc} (${group.length})`));
      out.append(h('table', { class: 'summary-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Concern'), h('th', {}, 'Yes'), h('th', {}, 'Not sure'), h('th', {}, 'No'), conds.map((c) => h('th', { title: CONDITIONS[c] || c }, `Yes in ${c}`)))),
        h('tbody', {}, items.map((q) => {
          const key = q.id.slice('specific_recall_'.length);
          const count = (sub, v) => sub.filter((p) => p.postAnswers[q.id] === v).length;
          const no = "No, I don't remember considering this";
          return h('tr', { class: lures.has(key) ? 'lure' : '' },
            h('td', {}, q.text, lures.has(key) ? h('span', { class: 'flag warn', title: 'Listed in codebook.reverseCodedRecall: not part of the scenario' }, 'reverse-coded') : null),
            h('td', { class: 'num' }, count(group, RECALL_YES)), h('td', { class: 'num' }, count(group, RECALL_UNSURE)), h('td', { class: 'num' }, count(group, no)),
            conds.map((c) => { const sub = group.filter((p) => (p.conditionCode ?? '?') === c); return h('td', { class: 'num' }, `${count(sub, RECALL_YES)}/${sub.length}`); }));
        }))));
    }
    return out;
  }

  function qualOptions(ps) {
    const opts = new Map([['chat', 'Chat messages to the colleague'], ['email', 'Submitted email']]);
    for (const p of ps) for (const q of STUDY_MATERIALS.scenarios[p.scenario]?.postTask || []) if (q.type === 'text') opts.set(q.id, q.id);
    opts.set('other_tools_used_other', 'other_tools_used_other');
    return opts;
  }
  function renderQualitative(ps) {
    const opts = qualOptions(ps);
    const sel = h('select', { onchange: (e) => { qualQuestion = e.target.value; rerenderAll(); } }, [...opts].map(([v, l]) => h('option', { value: v, selected: v === qualQuestion }, l)));
    const out = h('div', {}, h('label', {}, 'Question: ', sel));
    const groups = [...new Set(ps.map(groupOf))].sort();
    for (const g of groups) {
      const sub = ps.filter((p) => groupOf(p) === g);
      const cards = [];
      const shownQuestions = new Set();
      for (const p of sub) {
        const srcs = Rubric.sources(p);
        let picked;
        if (qualQuestion === 'chat') picked = srcs.filter((s) => s.kind === 'chat');
        else if (qualQuestion === 'email') picked = srcs.filter((s) => s.id === 'email');
        else picked = srcs.filter((s) => s.id === qualQuestion);
        if (!picked.length && p.postAnswers?.[qualQuestion]) picked = [{ id: qualQuestion, text: answerText(p.postAnswers[qualQuestion]) }];
        if (!picked.length) continue;
        const q = picked[0].question;
        const record = Rubric.current(p);
        cards.push(h('div', { class: 'qual-card' },
          h('div', { class: 'src-head' }, h('a', { href: '#' + encodeURIComponent(p.username), onclick: (e) => { e.preventDefault(); select(p); } }, p.username), h('span', { class: 'muted' }, ` · ${p.conditionCode ?? '?'} · ${p.scenario}`),
            q && !shownQuestions.has(q) && qualQuestion.startsWith('comprehension_') ? h('div', { class: 'muted' }, q) : null),
          picked.map((s) => {
            const { ranges } = record ? Rubric.rangesFor(record, s) : { ranges: [] };
            return h('div', { class: 'src-text' }, picked.length > 1 ? [h('span', { class: 'src-chip' }, s.id), ' '] : null, Rubric.highlight(s.text, ranges));
          })));
        if (q) shownQuestions.add(q);
      }
      out.append(h('h4', {}, `${groupLabel(g)} (${cards.length})`), cards.length ? h('div', { class: 'qual-list' }, cards) : h('p', { class: 'muted' }, 'No answers.'));
    }
    return out;
  }

  function render(ps, overlapN) {
    const toggle = h('span', { class: 'group-toggle' }, 'Group by: ', ['condition', 'scenario'].map((g) => h('label', {}, h('input', { type: 'radio', name: 'groupby', checked: groupBy === g, onchange: () => { groupBy = g; rerenderAll(); } }), ' ', g)));
    return h('div', {},
      h('div', { class: 'rubric-bar' }, toggle, groupBy === 'scenario' ? h('span', { class: 'muted' }, 'Shaded cells: scenario mean ≥ 1 sd from the overall mean (n ≥ 2). A screening aid, not a test.') : h('span', { class: 'muted' }, 'Hover a cell for n, median, sd and the answer counts.')),
      renderTable(ps),
      h('h3', {}, 'Overlap baseline'), renderBaseline(ps, overlapN),
      h('h3', {}, 'Specific recall by scenario'), renderRecall(ps),
      h('h3', {}, 'Free-text answers'), h('p', { class: 'muted' }, 'Rubric evidence is highlighted when the participant has been coded with the current codebook; plain text was not cited.'), renderQualitative(ps));
  }

  return { render };
})();
