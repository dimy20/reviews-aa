// Capa de datos. Todo lo que el dashboard lee o escribe pasa por acá.
//
// Con CONFIG.apiBase vacío (modo demostración) usa data/reviews.json y guarda
// las reseñas nuevas en este navegador (localStorage).
// Con CONFIG.apiBase definido usa solo dos rutas (ver dashboard/README.md):
//   GET  {apiBase}/reviews/          -> { dims, reviews: [...] }
//   POST {apiBase}/reviews/analyze   <- { text, name }  -> la reseña ya analizada
// Las respuestas y los seguimientos siempre quedan en este navegador.
import { CONFIG } from './config.js';
import { fromJSON, parseFile } from './data.js';

const K = { imp: 'ra-import', pend: 'ra-pending', act: 'ra-actions', ping: 'ra-ping' };
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  json(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
};

// mode: 'api' | 'demo' | 'import'
export const status = { mode: CONFIG.apiBase ? 'api' : 'demo', ok: true, at: null, error: '', name: '' };

let sampleCache = null;
let lastApiRows = null;

// Superpone las respuestas y los seguimientos guardados en este navegador.
const withActions = (rows) => {
  const acts = store.json(K.act, {});
  return rows.map((r) => (acts[r.id] ? { ...r, ...acts[r.id] } : r));
};

export async function loadReviews() {
  if (CONFIG.apiBase) {
    try {
      const res = await fetch(`${CONFIG.apiBase}/reviews/`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`La API respondió ${res.status}`);
      lastApiRows = fromJSON(await res.json());
      Object.assign(status, { mode: 'api', ok: true, at: Date.now(), error: '' });
    } catch (err) {
      Object.assign(status, { mode: 'api', ok: false, error: err.message });
    }
    return withActions(lastApiRows || []);
  }

  let rows = null;
  const imp = store.json(K.imp, null);
  if (imp && Array.isArray(imp.rows) && imp.rows.length) {
    rows = imp.rows;
    Object.assign(status, { mode: 'import', name: imp.name });
  } else {
    if (!sampleCache) {
      const res = await fetch(CONFIG.sampleData, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`No se pudo leer ${CONFIG.sampleData} (${res.status})`);
      sampleCache = fromJSON(await res.json());
    }
    rows = sampleCache;
    Object.assign(status, { mode: 'demo', name: '' });
  }
  Object.assign(status, { ok: true, at: Date.now(), error: '' });

  // Más las reseñas enviadas desde el formulario en este navegador.
  return withActions(rows).concat(store.json(K.pend, []));
}

export async function submitReview({ text, name }) {
  if (CONFIG.apiBase) {
    const res = await fetch(`${CONFIG.apiBase}/reviews/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, name: name || null }),
    });
    if (!res.ok) throw new Error(`La API respondió ${res.status}`);
    store.set(K.ping, String(Date.now())); // avisa al dashboard abierto en otra pestaña
    return;
  }
  const now = Date.now();
  const list = store.json(K.pend, []);
  list.push({
    id: `nueva-${now}`, text, t: now, date: new Date(now).toISOString().slice(0, 10),
    lang: '', rest: '', source: 'Formulario', name: name || '', orig: '',
    s: [0, 0, 0, 0, 0], ev: null, reply: '', replyAt: null, follow: false, pending: true,
  });
  if (!store.set(K.pend, JSON.stringify(list))) throw new Error('No se pudo guardar en este navegador.');
}

// Respuestas y seguimientos: la API no los guarda, quedan en este navegador.
export async function saveAction(id, patch) {
  const pend = store.json(K.pend, []);
  const p = pend.find((x) => x.id === id);
  if (p) { Object.assign(p, patch); store.set(K.pend, JSON.stringify(pend)); return; }
  const acts = store.json(K.act, {});
  acts[id] = { ...acts[id], ...patch };
  if (!store.set(K.act, JSON.stringify(acts))) throw new Error('No se pudo guardar en este navegador.');
}

export async function importFile(file) {
  const rows = await parseFile(file);
  if (!rows.length) throw new Error('No encontré reseñas con texto.');
  const saved = store.set(K.imp, JSON.stringify({ name: file.name, rows }));
  if (!saved) throw new Error('El archivo es demasiado grande para guardarlo en el navegador.');
  return rows.length;
}

export function clearImport() { store.del(K.imp); }

export const STORAGE_KEYS = K;
