// Utilidades de interfaz compartidas por todas las páginas.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const nf0 = new Intl.NumberFormat('es-AR');
const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const f1 = (v) => (v == null ? '—' : nf1.format(v));
export const pct = (v) => (v == null ? '—' : `${nf0.format(Math.round(v * 100))}%`);
export const signed = (v, fmt = f1) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
export const plural = (n, one, many) => `${nf0.format(n)} ${n === 1 ? one : many}`;
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const mFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dFmt = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const monthLabel = (t) => cap(mFmt.format(t).replace('.', ''));
export const dayLabel = (t) => dFmt.format(t).replace('.', '');
export const stripAcc = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
export const DIM_ICON = ['bowl', 'user', 'clock', 'tag', 'heart'];
export const LANG = { es: 'Español', pt: 'Portugués', en: 'Inglés' };

export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

const P = {
  chart: '<path d="M5 20v-6M10 20V9M15 20V4M20 20v-9"/>',
  message: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.4-4.6a8.5 8.5 0 1 1 15.6-4.4z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  store: '<path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6z"/><path d="M10 20v-5h4v5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  bowl: '<path d="M3 12h18a9 8 0 0 1-18 0z"/><path d="M8.5 4c0 1.6 1.5 1.9 1.5 3.5M13.5 4c0 1.6 1.5 1.9 1.5 3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.3-9.3A4.9 4.9 0 0 1 12 7a4.9 4.9 0 0 1 9.3 3.7C19.5 15.4 12 20 12 20z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 6.5v7M12 17.5v.5"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
};

export function icon(name, size = 20) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('icon');
  s.innerHTML = P[name] || '';
  return s;
}

let starSeq = 0;
export function stars(n, size = 16) {
  const wrap = h('span', { class: 'stars', role: 'img', 'aria-label': `${f1(n)} de 5 estrellas` });
  for (let i = 1; i <= 5; i++) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true');
    const frac = Math.max(0, Math.min(1, n - i + 1));
    const id = `st${++starSeq}`;
    s.innerHTML = `<defs><linearGradient id="${id}"><stop offset="${frac}" stop-color="var(--star)"/><stop offset="${frac}" stop-color="var(--star-off)"/></linearGradient></defs>`
      + `<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="url(#${id})"/>`;
    wrap.appendChild(s);
  }
  return wrap;
}

export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4200);
}

// Resalta la búsqueda sin usar innerHTML.
export function highlight(text, q) {
  const frag = document.createDocumentFragment();
  const qn = q ? stripAcc(q.trim()) : '';
  const tn = stripAcc(text);
  if (!qn || tn.length !== text.length) { frag.append(text); return frag; }
  let i = 0, j;
  while ((j = tn.indexOf(qn, i)) !== -1) {
    frag.append(text.slice(i, j), h('mark', { text: text.slice(j, j + qn.length) }));
    i = j + qn.length;
  }
  frag.append(text.slice(i));
  return frag;
}

// Imagen con respaldo: usa la versión en alta si existe y si no el recorte incluido.
export function img(src, fallback, attrs = {}) {
  const el = h('img', { src, alt: '', decoding: 'async', ...attrs });
  el.addEventListener('error', () => {
    if (fallback && !el.dataset.fb) { el.dataset.fb = '1'; el.classList.add('fallback'); el.src = fallback; }
    else el.hidden = true;
  });
  return el;
}

export function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
