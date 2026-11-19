import { CONFIG } from './config.js';
import { DIMS } from './data.js';
import { boot } from './shell.js';
import { saveAction } from './api.js';
import { $, h, icon, f1, pct, nf0, plural, dayLabel, stripAcc, highlight, toast } from './ui.js';
import { compute, weakest } from './metrics.js';
import { metaLine, reviewMeta, reviewAnalysis, reviewText, pendingSummary } from './review.js';

const params = new URLSearchParams(location.search);
const S = {
  q: '', dim: params.get('aspecto') ?? 'all', sent: params.get('sent') ?? 'all', preset: params.get('preset') ?? '',
  sort: params.get('sent') === 'neg' ? 'worst' : 'recent', limit: 25, sel: params.get('id'), replying: false, mobileOpen: Boolean(params.get('id')),
};
let ctx = null;
let weak = null;
const isNarrow = () => matchMedia('(max-width: 1023px)').matches;

document.title = `Reseñas · ${CONFIG.appName}`;
$('#ex-dim').append(...DIMS.map((d, i) => h('option', { value: String(i), text: d.label })));
$('#ex-dim').value = S.dim; $('#ex-sent').value = S.sent; $('#ex-sort').value = S.sort;

boot('resenas', (c) => { ctx = c; render(); });

function render() {
  const st = compute(ctx.cur);
  weak = weakest(st);
  renderKpis(st);
  renderChips();
  renderList();
  renderDetail();
}

const isNeg = (r) => r.s.some((v) => v && v <= 2);

function renderKpis(st) {
  const negs = ctx.cur.filter(isNeg);
  const noReply = negs.filter((r) => !r.reply).length;
  $('#kpis').replaceChildren(
    h('div', { class: 'card kpi' }, h('span', { class: 'kpi-label', text: 'Reseñas' }), h('span', { class: 'kpi-value', text: nf0.format(st.n) }),
      h('span', { class: 'kpi-sub', text: ctx.pending.length ? `+ ${pendingSummary(ctx.pending)}` : `${pct(1 - st.none / Math.max(1, st.n))} mencionan algún aspecto` })),
    h('div', { class: 'card kpi' }, h('span', { class: 'kpi-label', text: 'Negativas' }), h('span', { class: 'kpi-value', text: nf0.format(negs.length) }),
      h('span', { class: 'kpi-sub', text: `${pct(negs.length / Math.max(1, st.n))} del total tiene algún aspecto en 1–2` })),
    h('button', { class: 'card kpi clickable', type: 'button', onclick: () => setPreset('noreply') },
      h('span', { class: 'kpi-label', text: 'Sin respuesta' }), h('span', { class: 'kpi-value', text: nf0.format(noReply) }),
      h('span', { class: 'kpi-sub', text: `${pct(noReply / Math.max(1, negs.length))} de las negativas` })));
}

function renderChips() {
  const follow = ctx.cur.filter((r) => r.follow).length + ctx.pending.filter((r) => r.follow).length;
  const chips = [
    weak ? { id: 'crit', label: `${DIMS[weak.i].label} crítico` } : null,
    { id: 'noreply', label: 'Sin respuesta' },
    { id: 'follow', label: `En seguimiento${follow ? ` (${follow})` : ''}` },
    ctx.pending.length ? { id: 'pending', label: `Recibidas del formulario (${ctx.pending.length})` } : null,
  ].filter(Boolean);
  const critOn = weak && S.dim === String(weak.i) && S.sent === 'neg' && !S.preset;
  $('#chips').replaceChildren(...chips.map((c) => h('button', {
    type: 'button', class: 'pill', 'aria-pressed': String(c.id === 'crit' ? critOn : S.preset === c.id),
    onclick: () => (c.id === 'crit' ? toggleCrit(critOn) : setPreset(S.preset === c.id ? '' : c.id)),
  }, c.label)));
}

function setPreset(p) {
  S.preset = p; S.limit = 25;
  if (p) { S.dim = 'all'; S.sent = 'all'; $('#ex-dim').value = 'all'; $('#ex-sent').value = 'all'; }
  render();
}
function toggleCrit(on) {
  S.preset = ''; S.limit = 25;
  S.dim = on ? 'all' : String(weak.i); S.sent = on ? 'all' : 'neg'; S.sort = on ? 'recent' : 'worst';
  $('#ex-dim').value = S.dim; $('#ex-sent').value = S.sent; $('#ex-sort').value = S.sort;
  render();
}

function listRows() {
  const { q, dim, sent, preset, sort } = S;
  const qn = q ? stripAcc(q.trim()) : '';
  const di = dim === 'all' ? -1 : Number(dim);
  const ok = (v) => (sent === 'neg' ? v >= 1 && v <= 2 : sent === 'mid' ? v === 3 : sent === 'pos' ? v >= 4 : v > 0);
  // Las reseñas recibidas desde el formulario (todavía sin analizar) se muestran siempre, primero.
  const base = preset === 'pending' ? ctx.pending : ctx.pending.concat(ctx.cur);
  const rows = base.filter((r) => {
    if (preset === 'noreply' && !(isNeg(r) && !r.reply)) return false;
    if (preset === 'follow' && !r.follow) return false;
    if (di >= 0) { if (!r.s[di] || !ok(r.s[di])) return false; }
    else if (sent !== 'all' && !r.s.some(ok)) return false;
    if (qn) {
      r._n ??= stripAcc(`${r.text} ${r.orig} ${r.ev ? r.ev.join(' ') : ''} ${r.reply}`);
      if (!r._n.includes(qn)) return false;
    }
    return true;
  });
  const vals = (r) => (di >= 0 ? [r.s[di]] : r.s.filter(Boolean));
  const lo = (r) => { const v = vals(r); return v.length ? Math.min(...v) : 9; };
  const hi = (r) => { const v = vals(r); return v.length ? Math.max(...v) : 0; };
  const byT = (a, b) => (b.t ?? 0) - (a.t ?? 0);
  if (sort === 'recent') rows.sort(byT);
  else if (sort === 'old') rows.sort((a, b) => -byT(a, b));
  else if (sort === 'worst') rows.sort((a, b) => lo(a) - lo(b) || byT(a, b));
  else rows.sort((a, b) => hi(b) - hi(a) || byT(a, b));
  if (sort !== 'recent') rows.sort((a, b) => b.pending - a.pending); // las nuevas, siempre arriba
  return rows;
}

function scoreChips(r, focus = -1) {
  if (r.failed) return h('div', { class: 'chips' }, h('span', { class: 'chip error', title: r.error || null }, icon('alert', 14), 'No se pudo analizar'));
  if (r.pending) return h('div', { class: 'chips' }, h('span', { class: 'chip wait' }, icon('clock', 14), 'En análisis'));
  const chips = r.s.map((v, i) => (v ? h('span', { class: `chip ${v <= 2 ? 'neg' : v >= 4 ? 'pos' : ''}${i === focus ? ' focus' : ''}` }, DIMS[i].label, h('b', { text: f1(v) })) : null));
  if (!r.s.some(Boolean)) chips.push(h('span', { class: 'muted small', text: 'No menciona ningún aspecto' }));
  return h('div', { class: 'chips' }, chips);
}

function renderList() {
  const rows = listRows();
  S.rows = rows;
  const shown = rows.slice(0, S.limit);
  if (!S.sel || (!isNarrow() && !findRow(S.sel))) S.sel = !isNarrow() && shown[0] ? shown[0].id : S.sel;
  $('#count').textContent = rows.length ? `${plural(rows.length, 'reseña', 'reseñas')}${rows.length > shown.length ? ` · mostrando ${nf0.format(shown.length)}` : ''}` : '';
  const di = S.dim === 'all' ? -1 : Number(S.dim);
  $('#list').replaceChildren(...(shown.length ? shown.map((r) => h('button', {
    type: 'button', class: `item${r.id === S.sel ? ' selected' : ''}`, 'aria-current': r.id === S.sel ? 'true' : null,
    onclick: () => select(r.id),
  },
    h('div', { class: 'meta' }, h('span', { text: metaLine(r) }),
      h('span', { class: 'flags' }, r.reply ? h('span', { class: 'flag', title: 'Respondida' }, icon('reply', 14)) : null, r.follow ? h('span', { class: 'flag', title: 'En seguimiento' }, icon('flag', 14)) : null)),
    h('p', { class: 'quote clamp3' }, '“', highlight(r.text, S.q), '”'),
    scoreChips(r, di))) : [h('p', { class: 'list-empty muted', text: 'Ninguna reseña coincide con los filtros.' })]));
  $('#more').hidden = rows.length <= shown.length;
}

function findRow(id) {
  return id == null ? null : ctx.all.find((r) => r.id === id) || null;
}

function select(id) {
  S.sel = id; S.replying = false; S.mobileOpen = true;
  const u = new URL(location.href);
  u.searchParams.set('id', id);
  history.replaceState(null, '', u);
  renderList();
  renderDetail();
  if (isNarrow()) $('#detail').scrollTop = 0;
}

function renderDetail() {
  const el = $('#detail');
  const r = findRow(S.sel);
  document.body.classList.toggle('detail-open', Boolean(r) && S.mobileOpen && isNarrow());
  if (!r) { el.replaceChildren(h('div', { class: 'detail-empty' }, icon('message', 28), h('p', { text: 'Elegí una reseña para ver su análisis.' }))); return; }

  const back = h('button', { class: 'back', type: 'button', onclick: () => { S.mobileOpen = false; document.body.classList.remove('detail-open'); } }, icon('back', 18), 'Volver a la lista');
  const parts = [
    back,
    h('h2', { class: 'detail-title', text: 'Detalle de la reseña' }),
    reviewMeta(r),
    reviewText(r, S.q), // con búsqueda resalta lo buscado; sin búsqueda, las citas del modelo
  ];
  if (r.orig) {
    const det = h('details', { class: 'orig' }, h('summary', { text: 'Ver versión original' }), h('p', { text: r.orig }));
    parts.push(det);
  }

  parts.push(...reviewAnalysis(r, S.q));

  // Respuesta y seguimiento
  if (r.reply && !S.replying) {
    parts.push(h('div', { class: 'reply-box' },
      h('div', { class: 'reply-head' }, icon('reply', 16), h('b', { text: 'Tu respuesta' }), r.replyAt ? h('span', { class: 'muted', text: dayLabel(Date.parse(r.replyAt)) }) : null),
      h('p', { text: r.reply })));
  }
  if (S.replying) {
    const ta = h('textarea', { rows: 4, maxlength: 2000, placeholder: 'Escribí una respuesta amable y concreta…', 'aria-label': 'Respuesta' });
    ta.value = r.reply || '';
    parts.push(h('div', { class: 'reply-form' }, ta,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const reply = ta.value.trim();
          if (!reply) { ta.focus(); return; }
          await act(r, { reply, replyAt: new Date().toISOString() }, 'Respuesta guardada.');
          S.replying = false; render();
        } }, 'Guardar respuesta'),
        h('button', { class: 'btn', type: 'button', onclick: () => { S.replying = false; renderDetail(); } }, 'Cancelar'))));
    setTimeout(() => ta.focus(), 0);
  } else {
    parts.push(h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { S.replying = true; renderDetail(); } }, icon('reply', 18), r.reply ? 'Editar respuesta' : 'Responder'),
      h('button', { class: `btn${r.follow ? ' on' : ''}`, type: 'button', 'aria-pressed': String(r.follow), onclick: async () => {
        await act(r, { follow: !r.follow }, r.follow ? 'Quitada de seguimiento.' : 'Marcada para seguimiento.');
        render();
      } }, icon('flag', 18), r.follow ? 'En seguimiento' : 'Marcar para seguimiento')));
    parts.push(h('p', { class: 'muted small note', text: 'Las respuestas y el seguimiento se guardan en este navegador.' }));
  }
  el.replaceChildren(...parts);
}

async function act(r, patch, msg) {
  try {
    await saveAction(r.id, patch);
    Object.assign(r, patch);
    toast(msg);
  } catch (err) { toast(`No se pudo guardar: ${err.message}`); }
}

// ---------- Controles ----------
let qt;
$('#q').addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; S.limit = 25; renderList(); renderDetail(); }, 160); });
for (const [id, k] of [['#ex-dim', 'dim'], ['#ex-sent', 'sent'], ['#ex-sort', 'sort']]) {
  $(id).addEventListener('change', (e) => { S[k] = e.target.value; S.limit = 25; if (k !== 'sort') S.preset = ''; render(); });
}
$('#more').addEventListener('click', () => { S.limit += 30; renderList(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('detail-open')) { S.mobileOpen = false; document.body.classList.remove('detail-open'); } });
