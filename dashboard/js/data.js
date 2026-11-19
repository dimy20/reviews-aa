// Lectura y normalización de reseñas (JSON de la API o de ejemplo, CSV o JSON importado).

export const DIMS = [
  { key: 'food', label: 'Comida', art: 'la comida', aliases: ['food', 'comida', 'satisfaccion_comida', 'satisfaccion_con_la_comida'] },
  { key: 'wait_time', label: 'Espera', art: 'la espera', aliases: ['wait_time', 'wait', 'espera', 'tiempo_espera', 'tiempo_de_espera'] },
  { key: 'service', label: 'Atención', art: 'la atención', aliases: ['service', 'atencion'] },
  { key: 'price', label: 'Precio', art: 'el precio', aliases: ['price', 'precio'] },
  { key: 'experience', label: 'Experiencia', art: 'la experiencia', aliases: ['experience', 'experiencia'] },
];

const COLS = {
  text: ['text', 'review_text', 'review', 'resena', 'texto', 'comentario', 'comment'],
  date: ['date', 'fecha', 'review_date', 'created_at', 'fecha_resena'],
  lang: ['lang', 'idioma', 'language'],
  rest: ['restaurant', 'restaurante', 'local', 'sucursal', 'branch', 'business', 'business_name', 'negocio', 'store', 'tienda'],
  orig: ['original', 'source_en'],
  source: ['source', 'fuente', 'platform', 'plataforma', 'origen'],
  reply: ['reply', 'respuesta'],
  id: ['id', 'review_id'],
};

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s\-.]+/g, '_');

export async function parseFile(file) {
  const text = await file.text();
  const isJSON = /\.json$/i.test(file.name) || /^\s*[[{]/.test(text);
  return isJSON ? fromJSON(JSON.parse(text)) : fromObjects(parseCSV(text));
}

// ---------- JSON ----------
export function fromJSON(data) {
  const list = Array.isArray(data) ? data : data.reviews || data.data || [];
  if (!list.length) return [];
  const dims = Array.isArray(data.dims) ? data.dims : DIMS.map((d) => d.key);
  // Formato compacto: { dims, reviews: [{ id, text, scores: [...], quotes: [...], evidence: [...] }] }
  if (Array.isArray(list[0].scores) || list[0].pending || list[0].status === 'pending') {
    const idx = DIMS.map((d) => dims.indexOf(d.key));
    return list.map((r, i) => makeRow({
      ...r,
      id: r.id ?? i + 1,
      rest: r.restaurant ?? r.local,
      orig: r.original,
      s: idx.map((j) => (j < 0 || !r.scores ? null : r.scores[j])),
      ev: r.evidence ? idx.map((j) => (j < 0 ? null : r.evidence[j])) : null,
      qt: r.quotes ? idx.map((j) => (j < 0 ? null : r.quotes[j])) : null,
      pending: r.pending || r.status === 'pending',
      failed: r.status === 'error', // el pipeline falló: la API manda el motivo en r.error
    })).filter(Boolean);
  }
  return fromObjects(list);
}

// ---------- Filas planas (CSV o JSON de objetos) ----------
function fromObjects(rows) {
  if (!rows.length) throw new Error('El archivo no tiene filas.');
  const map = Object.fromEntries(Object.keys(rows[0]).map((k) => [norm(k), k]));
  const pick = (cands) => { for (const c of cands) if (c in map) return map[c]; return null; };

  const col = Object.fromEntries(Object.entries(COLS).map(([k, c]) => [k, pick(c)]));
  if (!col.text) throw new Error('Falta la columna con el texto de la reseña (text).');
  const dimCols = DIMS.map((d) => pick(d.aliases));
  if (dimCols.every((c) => !c)) throw new Error('No encontré columnas de puntajes (food, wait_time, service, price, experience).');
  const evCols = DIMS.map((d) => pick(d.aliases.flatMap((a) => [`${a}_evidence`, `${a}_evidencia`, `${a}_justification`, `${a}_justificacion`, `${a}_explicacion`])));
  const justCol = pick(['justifications', 'justificaciones', 'evidence', 'evidencia']);
  const qtCols = DIMS.map((d) => pick(d.aliases.flatMap((a) => [`${a}_quote`, `${a}_cita`, `${a}_fragmento`])));

  return rows.map((r, i) => {
    let ev = evCols.some(Boolean) ? evCols.map((c) => (c ? r[c] : null)) : null;
    const qt = qtCols.some(Boolean) ? qtCols.map((c) => (c ? r[c] : null)) : null;
    if (!ev && justCol && r[justCol]) {
      try {
        const j = typeof r[justCol] === 'string' ? JSON.parse(r[justCol]) : r[justCol];
        ev = DIMS.map((d) => j[d.key] ?? null);
      } catch { /* no es JSON: se ignora */ }
    }
    const get = (k) => (col[k] ? r[col[k]] : null);
    return makeRow({
      id: get('id') ?? i + 1, text: get('text'), date: get('date'), lang: get('lang'),
      rest: get('rest'), orig: get('orig'), source: get('source'), reply: get('reply'),
      s: dimCols.map((c) => (c ? r[c] : null)), ev, qt,
    });
  }).filter(Boolean);
}

function makeRow(r) {
  const text = r.text == null ? '' : String(r.text).trim();
  if (!text) return null;
  const s = (r.s || []).map(score);
  while (s.length < DIMS.length) s.push(0);
  const t = typeof r.t === 'number' ? r.t : parseDate(r.date ?? r.created_at);
  const orig = r.orig && String(r.orig).trim() !== text ? String(r.orig).trim() : '';
  return {
    id: String(r.id ?? ''),
    text,
    t,
    date: t == null ? '' : new Date(t).toISOString().slice(0, 10),
    lang: normLang(r.lang),
    rest: r.rest == null ? '' : String(r.rest).trim(),
    source: r.source ? String(r.source).trim() : '',
    name: r.name ? String(r.name).trim() : '',
    orig,
    s,
    ev: r.ev ? r.ev.map((e, i) => (s[i] && e ? String(e).trim() : '')) : null,
    qt: r.qt ? r.qt.map((e, i) => (s[i] && e ? String(e).trim() : '')) : null,
    reply: r.reply ? String(r.reply) : '',
    replyAt: r.replyAt ?? r.reply_at ?? null,
    follow: Boolean(r.follow),
    // pending: todavía sin puntajes (se está analizando o falló). failed: falló, con el motivo en error.
    pending: Boolean(r.pending || r.failed),
    failed: Boolean(r.failed),
    error: r.error ? String(r.error) : '',
  };
}

// 1..5 -> entero; vacío, -1 o N/A -> 0 (no lo menciona)
function score(v) {
  if (v == null || v === '') return 0;
  const n = Math.round(Number(String(v).replace(',', '.')));
  return n >= 1 && n <= 5 ? n : 0;
}

function normLang(v) {
  const s = v ? String(v).toLowerCase().slice(0, 2) : '';
  return /^[a-z]{2}$/.test(s) ? s : '';
}

function parseDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/);
  if (m && s.length <= 10) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    // Por defecto mes/día (Yelp); si el primero es > 12, es día/mes.
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return Date.UTC(y, mo - 1, d);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// ---------- CSV (RFC 4180; detecta , o ;) ----------
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const nl = text.indexOf('\n');
  const firstLine = nl < 0 ? text : text.slice(0, nl);
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift() || [];
  return rows
    .filter((r) => r.length > 1 || (r[0] && r[0].trim()))
    .map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

export function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['id', 'date', 'restaurant', 'source', 'lang', 'text', ...DIMS.map((d) => d.key), ...DIMS.map((d) => `${d.key}_evidence`), 'reply'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([r.id, r.date, r.rest, r.source, r.lang, r.text,
      ...r.s.map((v) => v || 'N/A'), ...DIMS.map((_, i) => (r.ev && r.ev[i]) || ''), r.reply].map(esc).join(','));
  }
  return '﻿' + lines.join('\r\n');
}
