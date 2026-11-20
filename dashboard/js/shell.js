// Estructura común del dashboard: menú lateral, estado de la API, filtros y carga de datos.
import { CONFIG } from './config.js';
import { loadReviews, status, store, STORAGE_KEYS } from './api.js';
import { applyFilters, timeRange, DEFAULT_FILTERS } from './metrics.js';
import { $, $$, h, icon, img, toast, nf0, monthLabel, LANG } from './ui.js';
import { showQr } from './qr.js';

const NAV = [
  { id: 'resumen', label: 'Resumen', icon: 'chart', href: 'index.html',
    // Secciones del Resumen: la marcada cambia a medida que bajás.
    subs: [{ id: 'resena', label: 'Reseñas' }, { id: 'aspectos', label: 'Por aspecto' }] },
];

// ---------- Menú lateral ----------
function mountSidebar(page) {
  const el = $('#sidebar');

  const links = NAV.flatMap((n) => [
    h('a', { class: 'nav-item', href: n.href, 'data-nav': n.id }, icon(n.icon), h('span', { text: n.label })),
    n.subs ? h('div', { class: 'nav-sub' }, n.subs.map((s) => h('a', {
      class: 'nav-subitem', 'data-sub': s.id,
      href: s.id === n.subs[0].id ? n.href : `${n.href}#${s.id}`,
      onclick: page === n.id ? (e) => { e.preventDefault(); goTo(s.id, s.id === n.subs[0].id); } : null,
    }, s.label))) : null,
  ]);

  const extra = h('div', { class: 'nav-extra' },
    h('a', { class: 'nav-item small', href: CONFIG.publicForm, target: '_blank', rel: 'noopener' }, icon('external', 18), h('span', { text: 'Formulario público' })),
    h('button', { class: 'nav-item small', type: 'button', onclick: () => showQr().catch((err) => { console.error(err); toast('No se pudo mostrar el código QR.'); }) },
      icon('qr', 18), h('span', { text: 'Código QR del formulario' })));

  el.replaceChildren(
    h('a', { class: 'brand', href: 'index.html' }, h('span', { text: CONFIG.appName }), h('i')),
    h('nav', { class: 'nav', 'aria-label': 'Secciones' }, links),
    extra,
    h('div', { class: 'leaves', 'aria-hidden': 'true' }, img('img/brownie-rincon.webp')));

  for (const a of $$('[data-nav]', el)) {
    a.classList.toggle('active', a.dataset.nav === page);
    if (a.dataset.nav === page) a.setAttribute('aria-current', 'page');
  }
  return page === 'resumen' ? spySections(el) : null;
}

// Lleva a una sección del Resumen; la primera es el principio de la página.
function goTo(id, isFirst) {
  const target = document.getElementById(id);
  if (isFirst || !target) scrollTo({ top: 0, behavior: 'smooth' });
  else target.scrollIntoView({ behavior: 'smooth' });
  history.replaceState(null, '', isFirst ? location.pathname : `#${id}`);
}

// Marca en el menú la sección que se está viendo.
function spySections(el) {
  const subs = [...$$('[data-sub]', el)];
  const spy = () => {
    const last = document.getElementById(subs[subs.length - 1].dataset.sub);
    const doc = document.documentElement;
    const atEnd = scrollY > 0 && scrollY + innerHeight >= doc.scrollHeight - 4;
    const cur = last && last.offsetParent && (atEnd || last.getBoundingClientRect().top < innerHeight * 0.55)
      ? last.id : subs[0].dataset.sub;
    for (const a of subs) a.classList.toggle('active', a.dataset.sub === cur);
  };
  addEventListener('scroll', spy, { passive: true });
  addEventListener('resize', spy);
  spy();
  return spy;
}

// ---------- Estado de la sincronización ----------
function mountSync() {
  const dot = h('i', { class: 'dot' });
  const main = h('b');
  const sub = h('span');
  $('#sync').replaceChildren(dot, main, h('span', { class: 'sep', 'aria-hidden': 'true' }), sub);
  const ago = () => {
    if (!status.at) return '';
    const m = Math.floor((Date.now() - status.at) / 60000);
    return m < 1 ? 'Actualizado recién' : m < 60 ? `Actualizado hace ${m} min` : `Actualizado hace ${Math.floor(m / 60)} h`;
  };
  const update = () => {
    let state, a, b;
    if (status.mode === 'api') {
      state = status.ok ? 'ok' : 'error';
      a = status.ok ? 'Reseñas al día' : 'Sin conexión';
      b = status.ok ? ago() : 'Reintentando…';
    } else if (status.mode === 'import') {
      state = 'idle'; a = 'Datos importados'; b = status.name;
    } else {
      state = 'idle'; a = 'Modo demostración'; b = 'Datos de ejemplo';
    }
    $('#sync').dataset.state = state;
    main.textContent = a;
    sub.textContent = b;
    // el detalle técnico queda en la consola, no en pantalla
    $('#sync').title = status.error ? 'No pudimos traer las reseñas nuevas. Lo seguimos intentando.' : '';
  };
  setInterval(update, 30000);
  return { update };
}

// ---------- Filtros (compartidos entre páginas) ----------
const FKEY = 'ra-filters';
const loadFilters = () => ({ ...DEFAULT_FILTERS, ...store.json(FKEY, {}) });
const saveFilters = (f) => store.set(FKEY, JSON.stringify(f));

function fbox(iconName, prefix, select) {
  return h('label', { class: 'fbox' }, iconName ? icon(iconName, 18) : null, prefix ? h('span', { class: 'prefix', text: prefix }) : null, select,
    h('span', { class: 'chev', 'aria-hidden': 'true' }));
}

function mountFilters(f, onChange) {
  const rest = h('select', { 'aria-label': 'Local' });
  const period = h('select', { 'aria-label': 'Período' });
  const lang = h('select', { 'aria-label': 'Idioma' });
  const restStatic = h('div', { class: 'fbox static' }, icon('store', 18), h('span', { text: CONFIG.restaurant }));
  const restBox = fbox('store', null, rest);
  const langBox = fbox(null, 'Idioma:', lang);

  $('#filters').replaceChildren(restStatic, restBox, fbox('calendar', null, period), langBox);
  const change = (k, el) => el.addEventListener('change', () => { f[k] = el.value; saveFilters(f); onChange(); });
  change('rest', rest); change('period', period); change('lang', lang);

  return {
    update(data) {
      const rests = [...data.scored.reduce((m, r) => (r.rest && m.set(r.rest, (m.get(r.rest) || 0) + 1), m), new Map())].sort((a, b) => b[1] - a[1]);
      restStatic.hidden = rests.length >= 2;
      restBox.hidden = rests.length < 2;
      rest.replaceChildren(h('option', { value: 'all', text: 'Todos los locales' }), ...rests.map(([r]) => h('option', { value: r, text: r })));
      if (f.rest !== 'all' && !rests.some(([r]) => r === f.rest)) f.rest = 'all';

      const [a, b] = [data.minT, data.maxT];
      period.replaceChildren(
        h('option', { value: 'all', text: a == null ? 'Todo el período' : `${monthLabel(a)} – ${monthLabel(b)}` }),
        ...(b == null ? [] : [['3', 'Últimos 3 meses'], ['12', 'Últimos 12 meses'], ['24', 'Últimos 2 años'], ['60', 'Últimos 5 años']].map(([v, t]) => h('option', { value: v, text: t }))));
      if (b == null) f.period = 'all';

      const langs = [...new Set(data.scored.map((r) => r.lang).filter(Boolean))].sort();
      lang.replaceChildren(h('option', { value: 'all', text: 'Todos' }), ...langs.map((l) => h('option', { value: l, text: LANG[l] || l.toUpperCase() })));
      if (f.lang !== 'all' && !langs.includes(f.lang)) f.lang = 'all';
      langBox.hidden = langs.length < 2;

      rest.value = f.rest; period.value = f.period; lang.value = f.lang;
    },
  };
}

// ---------- Arranque ----------
// onData recibe { all, scored, pending, cur, prev, win, minT, maxT, filters } cada vez que algo cambia.
export async function boot(page, onData) {
  const filters = loadFilters();
  let data = { all: [], scored: [], pending: [], minT: null, maxT: null };
  const emit = () => onData({ ...data, ...applyFilters(data.scored, filters, data.maxT), filters });

  const bar = mountFilters(filters, emit);
  const sync = mountSync();

  async function refresh() {
    try {
      const all = await loadReviews();
      const scored = all.filter((r) => !r.pending);
      const [minT, maxT] = timeRange(scored);
      data = { all, scored, pending: all.filter((r) => r.pending), minT, maxT };
    } catch (err) {
      console.error(err);
      status.ok = false; status.error = err.message;
      toast('No pudimos cargar las reseñas. Probá recargar la página en unos minutos.');
    }
    bar.update(data);
    sync.update();
    emit();
  }

  const spy = mountSidebar(page);

  await refresh();
  // Si se llegó con #aspectos desde otra página, ir ahí ahora que el contenido ya tiene su alto.
  const hashTarget = location.hash && document.getElementById(location.hash.slice(1));
  if (hashTarget) hashTarget.scrollIntoView({ behavior: 'instant' });
  if (spy) spy();
  if (CONFIG.apiBase) setInterval(refresh, CONFIG.refreshSeconds * 1000);

  // Reseñas enviadas desde el formulario público en otra pestaña de este navegador.
  addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.pend || e.key === STORAGE_KEYS.ping) { refresh(); toast('Llegó una reseña nueva desde el formulario.'); }
  });

  let rt, lastW = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === lastW) return;
    lastW = innerWidth;
    clearTimeout(rt); rt = setTimeout(emit, 150);
  });
  return { refresh };
}
