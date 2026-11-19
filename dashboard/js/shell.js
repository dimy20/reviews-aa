// Estructura común del dashboard: menú lateral, estado de la API, filtros y carga de datos.
import { CONFIG } from './config.js';
import { loadReviews, status, store, STORAGE_KEYS } from './api.js';
import { applyFilters, timeRange, DEFAULT_FILTERS } from './metrics.js';
import { $, $$, h, icon, img, toast, nf0, monthLabel, LANG } from './ui.js';

const NAV = [
  { id: 'resumen', label: 'Resumen', icon: 'chart', href: 'index.html#top' },
  { id: 'resenas', label: 'Reseñas', icon: 'message', href: 'resenas.html' },
  { id: 'aspectos', label: 'Aspectos', icon: 'layers', href: 'index.html#aspectos' },
  { id: 'evolucion', label: 'Evolución', icon: 'trend', href: 'index.html#evolucion' },
];

// ---------- Menú lateral ----------
function mountSidebar(page) {
  const el = $('#sidebar');

  const links = NAV.map((n) => h('a', { class: 'nav-item', href: n.href, 'data-nav': n.id }, icon(n.icon), h('span', { text: n.label })));

  const extra = h('div', { class: 'nav-extra' },
    h('a', { class: 'nav-item small', href: CONFIG.publicForm, target: '_blank', rel: 'noopener' }, icon('external', 18), h('span', { text: 'Formulario público' })));

  el.replaceChildren(
    h('a', { class: 'brand', href: 'index.html' }, h('span', { text: CONFIG.appName }), h('i')),
    h('nav', { class: 'nav', 'aria-label': 'Secciones' }, links),
    extra,
    h('div', { class: 'leaves', 'aria-hidden': 'true' }, img('img/brownie-rincon.webp')));

  const setActive = (id) => $$('[data-nav]', el).forEach((a) => a.classList.toggle('active', a.dataset.nav === id));
  setActive(page);
  if (page === 'resumen') {
    // Resalta Aspectos / Evolución según la sección visible.
    const spy = () => {
      let cur = 'resumen';
      for (const id of ['evolucion', 'aspectos']) {
        const s = document.getElementById(id);
        if (s && s.getBoundingClientRect().top < innerHeight * 0.4) { cur = id; break; }
      }
      setActive(cur);
    };
    addEventListener('scroll', () => requestAnimationFrame(spy), { passive: true });
  }
}

// ---------- Estado de la sincronización ----------
function mountSync() {
  // Botón visible para abrir la página que ven los clientes
  const sync = $('#sync');
  const wrap = h('div', { class: 'head-actions' });
  sync.replaceWith(wrap);
  wrap.append(h('a', { class: 'btn primary form-link', href: CONFIG.publicForm, target: '_blank', rel: 'noopener' }, icon('external', 18), 'Ver formulario de clientes'), sync);
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
      a = status.ok ? 'Sincronización API activa' : 'Sin conexión con la API';
      b = status.ok ? ago() : 'Reintentando…';
    } else if (status.mode === 'import') {
      state = 'idle'; a = 'Datos importados'; b = status.name;
    } else {
      state = 'idle'; a = 'Modo demostración'; b = 'Datos de ejemplo';
    }
    $('#sync').dataset.state = state;
    main.textContent = a;
    sub.textContent = b;
    $('#sync').title = status.error || '';
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
  const starsSel = h('select', { 'aria-label': 'Estrellas' });
  const restStatic = h('div', { class: 'fbox static' }, icon('store', 18), h('span', { text: CONFIG.restaurant }));
  const restBox = fbox('store', null, rest);
  const langBox = fbox(null, 'Idioma:', lang);
  const starsBox = fbox(null, 'Estrellas:', starsSel);
  starsSel.append(...[['all', 'Todas'], ['high', '4–5 ★'], ['mid', '3 ★'], ['low', '1–2 ★']].map(([v, t]) => h('option', { value: v, text: t })));

  $('#filters').replaceChildren(restStatic, restBox, fbox('calendar', null, period), langBox, starsBox);
  const change = (k, el) => el.addEventListener('change', () => { f[k] = el.value; saveFilters(f); onChange(); });
  change('rest', rest); change('period', period); change('lang', lang); change('stars', starsSel);

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
      starsBox.hidden = !data.scored.some((r) => r.rating);

      rest.value = f.rest; period.value = f.period; lang.value = f.lang; starsSel.value = f.stars;
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
      toast(location.protocol === 'file:' ? 'Abrí el dashboard con Live Server para cargar los datos.' : err.message);
    }
    bar.update(data);
    sync.update();
    emit();
  }

  mountSidebar(page);

  await refresh();
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
