import { CONFIG } from './config.js';
import { DIMS } from './data.js';
import { boot } from './shell.js';
import { $, h, icon, img, stars, f1, pct, nf0, plural, signed, dayLabel, SERIES, DIM_ICON } from './ui.js';
import { compute, weakest, strongest, priorities, trend, buckets, drivers, actionsFor } from './metrics.js';
import { lineChart, scoreAxis } from './charts.js';

let ctx = null;
let selected = null; // aspecto elegido para el análisis detallado
const hiddenSeries = new Set();

document.title = `Resumen · ${CONFIG.appName}`;
boot('resumen', (c) => { ctx = c; render(); });

function render() {
  const st = compute(ctx.cur);
  const pst = ctx.prev ? compute(ctx.prev) : null;
  const empty = !st.n;
  $('#content').hidden = empty;
  $('#empty').hidden = !empty;
  if (empty) return;
  if (selected == null || !st.dims[selected].m) selected = (weakest(st) || st.dims.find((d) => d.m) || { i: 0 }).i;
  renderKpis(st, pst);
  renderReceived();
  renderImportant(st, pst);
  renderPriority(st);
  renderAspects(st, pst);
  renderEvolution();
  renderCritical();
  renderDetail(st);
}

// ---------- Indicadores ----------
function deltaLine(cur, prev, { good = 'up', fmt = f1, unit = '' } = {}) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return h('span', { class: 'kpi-sub', text: 'Igual que el período anterior' });
  const ok = good === 'up' ? d > 0 : d < 0;
  return h('span', { class: `kpi-sub delta ${ok ? 'good' : 'bad'}`, text: `${signed(d, fmt)}${unit} vs. período anterior` });
}

function renderKpis(st, pst) {
  const w = weakest(st);
  const rating = st.avgR != null
    ? h('div', { class: 'card kpi' },
        h('span', { class: 'kpi-label', text: 'Rating promedio' }),
        h('span', { class: 'kpi-value' }, f1(st.avgR), h('small', { text: ' de 5' })),
        stars(st.avgR, 20),
        deltaLine(st.avgR, pst && pst.avgR))
    : h('div', { class: 'card kpi' },
        h('span', { class: 'kpi-label', text: 'Puntaje medio de aspectos' }),
        h('span', { class: 'kpi-value' }, f1(st.avgDims), h('small', { text: ' de 5' })));
  const reviews = h('div', { class: 'card kpi' },
    h('span', { class: 'kpi-label', text: 'Reseñas analizadas' }),
    h('span', { class: 'kpi-value', text: nf0.format(st.n) }),
    pst ? deltaLine(st.n, pst.n, { fmt: (v) => pct(v / pst.n) })
      : h('span', { class: 'kpi-sub', text: ctx.pending.length ? `${plural(ctx.pending.length, 'nueva', 'nuevas')} en análisis` : `${pct(1 - st.none / st.n)} mencionan algún aspecto` }));
  const hidden = h('a', { class: 'card kpi clickable', href: 'resenas.html?preset=hidden' },
    h('span', { class: 'kpi-label', text: 'Quejas en reseñas de 4–5 ★' }),
    h('span', { class: 'kpi-value', text: nf0.format(st.hidden) }),
    h('span', { class: 'kpi-sub', text: `${pct(st.hidden / st.n)} de las reseñas · ver cuáles` }));
  const crit = w
    ? h('button', { class: 'card kpi clickable', type: 'button', onclick: () => selectAspect(w.i, true) },
        h('span', { class: 'kpi-label', text: 'Aspecto crítico' }),
        h('span', { class: 'kpi-value', text: DIMS[w.i].label }),
        h('span', { class: 'kpi-sub', text: `${f1(w.avg)} de 5 · ${nf0.format(w.m)} menciones` }))
    : h('div', { class: 'card kpi' }, h('span', { class: 'kpi-label', text: 'Aspecto crítico' }), h('span', { class: 'kpi-value', text: '—' }));
  $('#kpis').replaceChildren(rating, reviews, hidden, crit);
}

// ---------- Reseñas recibidas desde el formulario ----------
function renderReceived() {
  const list = [...ctx.pending].sort((a, b) => (b.t ?? 0) - (a.t ?? 0));
  $('#received').hidden = !list.length;
  if (!list.length) return;
  $('#received-list').replaceChildren(...list.slice(0, 3).map((r) => h('a', { class: 'received-item', href: `resenas.html?id=${encodeURIComponent(r.id)}` },
    h('div', { class: 'meta' },
      r.rating ? stars(r.rating, 15) : h('span', { class: 'no-rating', text: 'Sin estrellas' }),
      h('span', { text: [r.t != null ? dayLabel(r.t) : '', r.name].filter(Boolean).join(' · ') })),
    h('q', { class: 'clamp3', text: r.text }),
    h('span', { class: 'chip wait' }, icon('clock', 14), 'En análisis'))));
}

// ---------- Lo importante ----------
function renderImportant(st, pst) {
  const items = [];
  const best = strongest(st), worst = weakest(st), top = priorities(st)[0];
  const L = (d) => DIMS[d.i].label;
  if (best) items.push(['good', h('b', { text: `${L(best)} es tu fortaleza` }), ` (${f1(best.avg)} de 5): el ${pct(best.posMent)} de quienes la mencionan la elogia.`]);
  if (worst && worst !== best) items.push(['bad', h('b', { text: `${L(worst)} es el principal foco de mejora` }), ` (${f1(worst.avg)} de 5): el ${pct(worst.negMent)} de las menciones son negativas.`]);
  if (top && top !== worst) {
    items.push(['bad', h('b', { text: `${L(top)} genera quejas (${pct(top.negAll)})` }),
      top.impact != null ? `: cuando falla, las reseñas bajan a ${f1(top.starsNeg)} ★.` : ' de todas las reseñas.']);
  } else if (st.hidden) {
    items.push(['eye', h('b', { text: `${nf0.format(st.hidden)} reseñas de 4–5 ★ esconden una queja` }), ': la nota global no las muestra.']);
  }
  if (pst) {
    const moves = st.dims.map((d, i) => ({ i, d: d.m >= 5 && pst.dims[i].m >= 5 ? d.avg - pst.dims[i].avg : 0 }))
      .filter((x) => Math.abs(x.d) >= 0.2).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    if (moves.length) items.push([moves[0].d > 0 ? 'good' : 'bad', h('b', { text: `${DIMS[moves[0].i].label} ${moves[0].d > 0 ? 'mejoró' : 'empeoró'} ${f1(Math.abs(moves[0].d))} puntos` }), ' respecto del período anterior.']);
  }
  if (ctx.pending.length) items.push(['info', h('b', { text: ctx.pending.length === 1 ? '1 reseña nueva' : `${nf0.format(ctx.pending.length)} reseñas nuevas` }), ' esperando el análisis del modelo.']);
  if (!items.length) items.push(['info', 'Todavía no hay menciones suficientes para sacar conclusiones.']);
  const ICON = { good: 'check', bad: 'alert', eye: 'eye', info: 'sparkle' };
  $('#important-list').replaceChildren(...items.slice(0, 4).map(([k, ...body]) =>
    h('li', null, h('span', { class: `bullet ${k}` }, icon(ICON[k], 16)), h('span', null, body))));
}

function renderPriority(st) {
  const list = priorities(st).slice(0, 3);
  const el = $('#priority');
  if (!list.length) { el.replaceChildren(h('li', { class: 'muted', text: 'No hay quejas en este período.' })); return; }
  el.replaceChildren(...list.map((d, k) => h('li', null,
    h('span', { class: 'rank', text: k + 1 }),
    h('div', { class: 'prio-body' },
      h('div', { class: 'prio-top' },
        h('button', { class: 'prio-name', type: 'button', text: DIMS[d.i].label, onclick: () => selectAspect(d.i, true) }),
        h('span', { class: 'prio-val', text: `${pct(d.negAll)} se quejan` })),
      h('div', { class: 'track' }, h('i', { style: `width:${Math.max(3, d.negAll * 100)}%` })),
      d.impact != null ? h('span', { class: 'prio-note', text: `Cuando falla: ${f1(d.starsNeg)} ★ · cuando está bien: ${f1(d.starsPos)} ★` }) : null))));
}

// ---------- Aspectos ----------
function renderAspects(st, pst) {
  $('#aspects').replaceChildren(...st.dims.map((d, i) => {
    const head = h('div', { class: 'asp-head' }, icon(DIM_ICON[i], 20), h('span', { text: DIMS[i].label }));
    if (!d.m) return h('div', { class: 'card asp empty' }, head, h('p', { class: 'muted', text: 'Sin menciones en este período' }));
    const p = pst && pst.dims[i].m >= 5 && d.m >= 5 ? pst.dims[i].avg : null;
    const bar = h('div', { class: 'stack', role: 'img', 'aria-label': `${pct(d.posMent)} positivas, ${pct(d.midMent)} mixtas, ${pct(d.negMent)} negativas` },
      d.pos ? h('i', { class: 'pos', style: `flex:${d.pos}` }) : null,
      d.mid ? h('i', { class: 'mid', style: `flex:${d.mid}` }) : null,
      d.neg ? h('i', { class: 'neg', style: `flex:${d.neg}` }) : null);
    return h('button', { class: `card asp${i === selected ? ' selected' : ''}`, type: 'button', 'aria-pressed': String(i === selected), onclick: () => selectAspect(i, true) },
      head,
      h('div', { class: 'asp-mid' },
        h('span', { class: 'asp-score' }, f1(d.avg), h('small', { text: ' / 5' })),
        h('span', { class: 'asp-ment', text: `${pct(d.mention)} de las reseñas la mencionan` })),
      p != null ? h('span', { class: `asp-delta ${d.avg - p >= 0 ? 'good' : 'bad'}`, text: `${signed(d.avg - p)} vs. período anterior` }) : null,
      bar,
      h('div', { class: 'asp-foot' }, h('span', { text: `${pct(d.posMent)} positivas` }), h('span', { text: `${pct(d.negMent)} negativas` })));
  }));
}

function selectAspect(i, scroll) {
  selected = i;
  render();
  if (scroll) document.getElementById('aspectos').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Evolución ----------
function renderEvolution() {
  const b = buckets(ctx.cur);
  const host = $('#evo-chart');
  if (!b) {
    $('#evo-legend').replaceChildren();
    $('#evo-table').replaceChildren();
    host.replaceChildren(h('p', { class: 'chart-empty', text: ctx.maxT == null ? 'Los datos no tienen fechas.' : 'Hace falta más de un período para ver la evolución.' }));
    return;
  }
  const stats = b.list.map((x) => compute(x.rows));
  const series = DIMS.map((d, i) => ({ i, label: d.label, color: SERIES[i], values: stats.map((s) => (s.dims[i].m >= 3 ? s.dims[i].avg : null)) }));
  $('#evo-legend').replaceChildren(...series.map((s) => h('button', {
    type: 'button', 'aria-pressed': String(!hiddenSeries.has(s.i)),
    onclick: () => { hiddenSeries.has(s.i) ? hiddenSeries.delete(s.i) : hiddenSeries.add(s.i); renderEvolution(); },
  }, h('i', { class: 'key', style: `background:${s.color}` }), s.label)));
  const visible = series.filter((s) => !hiddenSeries.has(s.i));
  const { domain, ticks } = scoreAxis(visible);
  const labels = b.list.map((x) => x.label);
  lineChart(host, {
    labels, series: visible, domain, ticks, fmt: f1, height: 230,
    extra: (i) => [{ label: 'reseñas en el período', value: nf0.format(b.list[i].rows.length) }],
  });
  $('#evo-table').replaceChildren(h('table', { class: 'data' },
    h('thead', null, h('tr', null, h('th', { text: 'Período' }), h('th', { text: 'Reseñas' }), ...DIMS.map((d) => h('th', { text: d.label })))),
    h('tbody', null, b.list.map((x, k) => h('tr', null, h('td', { text: x.label }), h('td', { text: nf0.format(x.rows.length) }),
      ...series.map((s) => h('td', { text: f1(s.values[k]) })))))));
}

function renderCritical() {
  let r = null;
  for (const x of ctx.cur) if (x.s.some((v) => v && v <= 2) && (!r || (x.t ?? 0) > (r.t ?? 0))) r = x;
  const el = $('#critical');
  if (!r) { el.replaceChildren(h('h2', { class: 'card-title', text: 'Última reseña crítica' }), h('p', { class: 'muted', text: 'No hay reseñas con quejas en este período.' })); return; }
  el.replaceChildren(
    h('h2', { class: 'card-title', text: 'Última reseña crítica' }),
    h('div', { class: 'meta' }, r.rating ? stars(r.rating, 16) : null, h('span', { text: [r.t != null ? dayLabel(r.t) : '', r.source, (r.lang || '').toUpperCase()].filter(Boolean).join(' · ') })),
    h('blockquote', { class: 'quote clamp', text: `“${r.text}”` }),
    h('div', { class: 'chips' }, r.s.map((v, i) => (v ? h('span', { class: `chip ${v <= 2 ? 'neg' : v >= 4 ? 'pos' : ''}` }, DIMS[i].label, h('b', { text: f1(v) })) : null))),
    h('a', { class: 'link', href: `resenas.html?id=${encodeURIComponent(r.id)}` }, 'Ver análisis completo', icon('arrow', 16)));
}

// ---------- Análisis del aspecto elegido ----------
function renderDetail(st) {
  const i = selected;
  const d = st.dims[i];
  const name = DIMS[i].label;
  $('#asp-tabs').replaceChildren(...DIMS.map((x, k) => h('button', {
    type: 'button', class: 'tab', 'aria-pressed': String(k === i), onclick: () => selectAspect(k, false),
  }, icon(DIM_ICON[k], 16), x.label)));

  const tr = trend(ctx.cur, ctx.prev, i);
  $('#asp-band').replaceChildren(
    h('div', { class: 'band-name' }, h('span', { class: 'eyebrow', text: 'Aspecto' }), h('strong', { text: name }), h('i')),
    h('div', { class: 'band-stats' },
      h('div', null, h('b', null, f1(d.avg), h('small', { text: ' / 5' })), h('span', { text: 'Puntuación' })),
      h('div', null, h('b', { text: nf0.format(d.m) }), h('span', { text: 'Menciones' })),
      h('div', null, h('b', { text: pct(d.negMent) }), h('span', { text: '% negativas' })),
      h('div', null, h('b', { text: tr ? signed(tr.d) : '—' }), h('span', { text: 'Tendencia' }), h('small', { text: tr ? tr.basis : 'sin datos suficientes' }))),
    h('div', { class: 'band-img', 'aria-hidden': 'true' }, img('img/brownie-plato.webp')));

  // Conclusiones y acciones
  const negD = drivers(ctx.cur, i, 'neg');
  const posD = drivers(ctx.cur, i, 'pos');
  const concl = [`${name} tiene ${f1(d.avg)} de 5 y aparece en el ${pct(d.mention)} de las reseñas; el ${pct(d.negMent)} de esas menciones son negativas.`];
  if (negD.length) concl.push(`Las quejas hablan sobre todo de ${negD.slice(0, 3).map((x) => `“${x.label}”`).join(', ')}.`);
  if (d.impact != null) concl.push(`Cuando falla, la reseña promedia ${f1(d.starsNeg)} ★; cuando está bien, ${f1(d.starsPos)} ★.`);
  if (tr) concl.push(Math.abs(tr.d) < 0.1 ? `La tendencia es estable (${tr.basis}).` : `La tendencia es ${tr.d > 0 ? 'positiva' : 'negativa'} (${signed(tr.d)}, ${tr.basis}).`);
  $('#asp-concl').replaceChildren(...concl.map((t) => h('li', null, h('span', { class: 'bullet info' }, icon('sparkle', 14)), h('span', { text: t }))));
  $('#asp-actions').replaceChildren(...(d.neg ? actionsFor(i, negD) : ['No hay quejas sobre este aspecto: mantené lo que funciona.'])
    .map((t) => h('li', null, h('span', { class: 'bullet good' }, icon('check', 14)), h('span', { text: t }))));

  // Evolución del aspecto: se dibuja después de las conclusiones para igualar alturas
  requestAnimationFrame(() => {
  const b = buckets(ctx.cur);
  $('#asp-evo-title').textContent = `Evolución de ${name}`;
  if (b) {
    const values = b.list.map((x) => { let s = 0, n = 0; for (const r of x.rows) if (r.s[i]) { s += r.s[i]; n++; } return n >= 3 ? s / n : null; });
    const series = [{ label: name, color: 'var(--cacao)', values }];
    const { domain, ticks } = scoreAxis(series);
    lineChart($('#asp-evo'), {
      labels: b.list.map((x) => x.label), series, domain, ticks, fmt: f1, endLabel: true, height: Math.max(220, Math.min(420, $('.stack-cards').offsetHeight - 92)),
      extra: (k) => [{ label: 'menciones', value: nf0.format(b.list[k].rows.filter((r) => r.s[i]).length) }],
    });
  } else $('#asp-evo').replaceChildren(h('p', { class: 'chart-empty', text: 'Sin fechas suficientes.' }));

  });

  // Qué impulsa el resultado
  const chipRow = (list, kind) => (list.length
    ? list.slice(0, 6).map((x) => h('span', { class: `driver ${kind}`, title: `${nf0.format(x.c)} reseñas` }, x.label, h('small', { text: nf0.format(x.c) })))
    : [h('span', { class: 'muted small', text: 'Sin palabras que se repitan' })]);
  $('#asp-drivers').replaceChildren(
    h('div', { class: 'driver-row' }, h('span', { class: 'driver-label', text: 'En las quejas' }), h('div', { class: 'driver-list' }, chipRow(negD, 'neg'))),
    h('div', { class: 'driver-row' }, h('span', { class: 'driver-label', text: 'En los elogios' }), h('div', { class: 'driver-list' }, chipRow(posD, 'pos'))));

  // Reseñas relacionadas: primero las negativas más recientes
  const related = ctx.cur.filter((r) => r.s[i])
    .sort((a, b) => ((b.s[i] <= 2) - (a.s[i] <= 2)) || ((b.t ?? 0) - (a.t ?? 0)))
    .slice(0, 3);
  $('#asp-related-title').textContent = `Reseñas sobre ${name}`;
  $('#asp-related').replaceChildren(...related.map((r) => h('a', { class: 'related', href: `resenas.html?id=${encodeURIComponent(r.id)}` },
    h('q', { class: 'clamp3', text: r.text }),
    h('span', { class: 'meta' }, h('span', { class: `score-dot s${r.s[i]}` }), `${name} ${r.s[i]}/5`, r.t != null ? ` · ${dayLabel(r.t)}` : ''))));
  $('#asp-related-all').href = `resenas.html?aspecto=${i}&sent=neg`;
}
