import { CONFIG } from './config.js';
import { DIMS } from './data.js';
import { boot } from './shell.js';
import { $, h, icon, f1, pct, nf0, signed, DIM_ICON } from './ui.js';
import { compute, priorities, drivers, actionsFor } from './metrics.js';
import { reviewMeta, reviewAnalysis, reviewText, pendingSummary } from './review.js';

let ctx = null;
// Reseña que se está viendo. Si estás en la primera, al llegar una nueva pasa a mostrar la nueva.
const V = { rows: [], k: 0, id: null, first: true, full: false };

document.title = `Resumen · ${CONFIG.appName}`;
boot('resumen', (c) => { ctx = c; render(); });

function render() {
  const st = compute(ctx.cur);
  const pst = ctx.prev ? compute(ctx.prev) : null;
  const empty = !st.n && !ctx.pending.length;
  $('#content').hidden = empty;
  $('#empty').hidden = !empty;
  if (empty) return;
  renderViewer();
  renderCount(st);
  renderFix(st);
  renderAspects(st, pst);
}

// ---------- Reseña por reseña ----------
function renderViewer() {
  const byT = (a, b) => (b.t ?? 0) - (a.t ?? 0);
  // Las que esperan el modelo primero; después, de la más nueva a la más vieja.
  V.rows = [...ctx.pending].sort(byT).concat([...ctx.cur].sort(byT));
  const k = V.first ? 0 : V.rows.findIndex((r) => r.id === V.id);
  show(k < 0 ? 0 : k);
}

function show(k, focus) {
  const el = $('#viewer');
  const n = V.rows.length;
  if (!n) {
    el.replaceChildren(h('div', { class: 'detail-empty' }, icon('message', 28), h('p', { text: 'No hay reseñas para estos filtros.' })));
    return;
  }
  k = Math.max(0, Math.min(n - 1, k));
  const r = V.rows[k];
  if (r.id !== V.id) V.full = false;
  Object.assign(V, { k, id: r.id, first: k === 0 });

  const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Reseña anterior', disabled: k === 0, onclick: () => show(k - 1, 'prev') }, icon('back', 18));
  const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Reseña siguiente', disabled: k === n - 1, onclick: () => show(k + 1, 'next') }, icon('next', 18));
  const long = r.text.length > 420;

  el.replaceChildren(...[
    h('div', { class: 'viewer-head' },
      h('div', null,
        h('h2', { class: 'card-title', text: 'Reseña por reseña' }),
        h('p', { class: 'muted small', text: 'De la más nueva a la más vieja. También podés usar las flechas del teclado.' })),
      h('div', { class: 'viewer-nav' },
        h('span', { class: 'viewer-pos', 'aria-live': 'polite', text: `${nf0.format(k + 1)} de ${nf0.format(n)}` }), prev, next)),
    reviewMeta(r),
    reviewText(r, '', `quote big${long && !V.full ? ' clamp' : ''}`),
    long ? h('button', { class: 'more-text', type: 'button', onclick: () => { V.full = !V.full; show(k); } }, V.full ? 'Ver menos' : 'Leer completa') : null,
    ...reviewAnalysis(r),
    h('a', { class: 'link viewer-link', href: `resenas.html?id=${encodeURIComponent(r.id)}` }, 'Responder o marcar en Reseñas', icon('arrow', 16)),
  ].filter(Boolean));

  if (focus) {
    const b = focus === 'prev' ? (prev.disabled ? next : prev) : (next.disabled ? prev : next);
    b.focus();
  }
}

$('#viewer').addEventListener('keydown', (e) => {
  if (e.target.closest('a, textarea, input')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); show(V.k - 1, 'prev'); }
  if (e.key === 'ArrowRight') { e.preventDefault(); show(V.k + 1, 'next'); }
});

// ---------- Cuántas reseñas ----------
function renderCount(st) {
  const p = ctx.pending.length;
  $('#kpi-count').replaceChildren(
    h('span', { class: 'kpi-label', text: 'Reseñas' }),
    h('span', { class: 'kpi-value', text: nf0.format(st.n + p) }),
    h('span', { class: 'kpi-sub', text: p ? pendingSummary(ctx.pending) : `${pct(1 - st.none / Math.max(1, st.n))} mencionan algún aspecto` }));
}

// ---------- Lo principal a arreglar ----------
function renderFix(st) {
  const [top, ...rest] = priorities(st);
  const head = (name) => [
    h('span', { class: 'eyebrow', text: 'Lo principal a arreglar' }),
    h('strong', { class: 'fix-name', text: name }),
    h('i', { class: 'rule', 'aria-hidden': 'true' }),
  ];
  if (!top) {
    $('#fix-body').replaceChildren(...head('Nada urgente'), h('p', { text: 'No hay quejas que se repitan en estas reseñas.' }));
    return;
  }
  const d = DIMS[top.i];
  const act = actionsFor(top.i, drivers(ctx.cur, top.i, 'neg'))[0];
  // filter(Boolean): replaceChildren escribe "null" si le llega un null (h() sí los ignora)
  $('#fix-body').replaceChildren(...[
    ...head(d.label),
    h('p', null, h('b', { text: `El ${pct(top.negAll)} de las reseñas` }), ` se queja de ${d.art}.`),
    act ? h('p', null, h('b', { text: 'Qué hacer: ' }), act) : null,
    rest.length ? h('p', { class: 'fix-next', text: `Le siguen: ${rest.slice(0, 2).map((x) => DIMS[x.i].label).join(' y ')}` }) : null,
    h('a', { class: 'link light', href: `resenas.html?aspecto=${top.i}&sent=neg` }, 'Ver esas reseñas', icon('arrow', 16)),
  ].filter(Boolean));
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
    return h('a', { class: 'card asp', href: `resenas.html?aspecto=${i}` },
      head,
      h('div', { class: 'asp-mid' },
        h('span', { class: 'asp-score' }, f1(d.avg), h('small', { text: ' / 5' })),
        h('span', { class: 'asp-ment', text: `${pct(d.mention)} de las reseñas lo mencionan` })),
      p != null ? h('span', { class: `asp-delta ${d.avg - p >= 0 ? 'good' : 'bad'}`, text: `${signed(d.avg - p)} vs. período anterior` }) : null,
      bar,
      h('div', { class: 'asp-foot' }, h('span', { text: `${pct(d.posMent)} positivas` }), h('span', { text: `${pct(d.negMent)} negativas` })));
  }));
}
