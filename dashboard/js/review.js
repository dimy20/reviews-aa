// Cómo se muestra una reseña con su análisis. Lo usan el Resumen y la página de Reseñas.
import { DIMS } from './data.js';
import { h, icon, f1, dayLabel, highlight, plural, DIM_ICON } from './ui.js';
import { fragment, explainReview } from './metrics.js';
import { CONFIG } from './config.js';

// La explicación de un aspecto, dentro del largo de CONFIG.explanationWords.
// Muy corta (menos de min palabras) no dice nada: se muestra "—". Muy larga se corta en max.
function explanation(text) {
  const { min, max } = CONFIG.explanationWords;
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < min) return '—';
  return words.length > max ? words.slice(0, max).join(' ') + '…' : words.join(' ');
}

export function metaLine(r) {
  return [r.t != null ? dayLabel(r.t) : '', r.source, r.lang ? r.lang.toUpperCase() : ''].filter(Boolean).join(' · ');
}

// Fecha, origen, idioma y nombre.
export function reviewMeta(r) {
  return h('div', { class: 'meta' },
    h('span', { text: metaLine(r) }),
    r.name ? h('span', { text: `· ${r.name}` }) : null);
}

// Para los indicadores: "2 nuevas en análisis · 1 no se pudo analizar".
export function pendingSummary(pending) {
  const failed = pending.filter((r) => r.failed).length;
  const waiting = pending.length - failed;
  return [
    waiting ? `${plural(waiting, 'nueva', 'nuevas')} en análisis` : '',
    failed ? `${plural(failed, 'no se pudo', 'no se pudieron')} analizar` : '',
  ].filter(Boolean).join(' · ');
}

// ---------- Citas resaltadas en el texto ----------

// Dónde está la cita dentro del texto. No importan las mayúsculas, los espacios ni si las
// comillas son rectas o curvas (la API ya revisó que la cita salga de la reseña).
function findQuote(text, quote) {
  const words = quote.trim().split(/\s+/).map((w) => w
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // los caracteres especiales de una regex, literales
    .replace(/['’‘]/g, "['’‘]")
    .replace(/["“”]/g, '["“”]'));
  const match = new RegExp(words.join('\\s+'), 'i').exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}

// El texto de la reseña con la cita de cada aspecto resaltada (<mark>). Al pasar el mouse por un
// resaltado se ve de qué aspecto es: "Espera · 1/5". Si dos aspectos usan la misma cita, se juntan.
function textWithQuotes(r) {
  const marks = new Map(); // "inicio-fin" -> { start, end, title }
  DIMS.forEach((d, i) => {
    const quote = r.qt && r.qt[i];
    const at = quote && r.s[i] ? findQuote(r.text, quote) : null;
    if (!at) return;
    const title = `${d.label} · ${r.s[i]}/5`;
    const key = `${at.start}-${at.end}`;
    marks.set(key, marks.has(key) ? { ...at, title: `${marks.get(key).title}, ${title}` } : { ...at, title });
  });

  const out = [];
  let pos = 0;
  for (const m of [...marks.values()].sort((a, b) => a.start - b.start)) {
    if (m.start < pos) continue; // se pisa con la anterior: queda la anterior
    out.push(r.text.slice(pos, m.start), h('mark', { class: 'evidence', title: m.title, text: r.text.slice(m.start, m.end) }));
    pos = m.end;
  }
  out.push(r.text.slice(pos));
  return out;
}

// El texto de la reseña entre comillas. Si hay una búsqueda (q), se resalta lo buscado;
// si no, las citas en las que se basa cada puntaje.
export function reviewText(r, q = '', cls = 'quote big') {
  return h('blockquote', { class: cls }, '“', q ? highlight(r.text, q) : textWithQuotes(r), '”');
}

// ---------- Tabla de aspectos ----------

// Tabla con el puntaje de cada aspecto y la explicación general.
export function reviewAnalysis(r, q = '') {
  if (r.failed) {
    return [
      h('div', { class: 'notice error' }, icon('alert', 18),
        h('span', { text: 'No se pudo analizar esta reseña. El texto quedó guardado, pero todavía no tiene puntajes ni explicación.' })),
      r.error ? h('p', { class: 'muted small error-detail', text: `Motivo: ${r.error}` }) : null,
    ];
  }
  if (r.pending) {
    return [h('div', { class: 'notice' }, icon('clock', 18), h('span', { text: 'Esta reseña llegó desde el formulario y todavía no pasó por el modelo. Cuando la API la procese, acá vas a ver el puntaje y la explicación de cada aspecto.' }))];
  }
  const hasQuotes = Boolean(r.qt && r.qt.some(Boolean));
  return [
    h('h3', { class: 'sub-title', text: 'Análisis por aspecto' }),
    hasQuotes ? h('p', { class: 'muted small', text: 'En la reseña están resaltadas las frases en las que se basa cada puntaje.' }) : null,
    h('div', { class: 'table-scroll' }, h('table', { class: 'asp-table' },
      h('thead', null, h('tr', null, ['Aspecto', 'Puntuación', 'Fragmento', 'Explicación'].map((t) => h('th', { text: t })))),
      h('tbody', null, DIMS.map((d, i) => {
        const v = r.s[i];
        const name = h('td', { class: 'a-name' }, icon(DIM_ICON[i], 18), d.label);
        if (!v) return h('tr', { class: 'na' }, name, h('td', { colspan: 3, text: 'No lo menciona (N/A)' }));
        // La cita que eligió el modelo; si no hay, la frase que menciona el aspecto (por palabras clave).
        const frag = (r.qt && r.qt[i]) || fragment(r.text, i);
        return h('tr', null, name,
          h('td', { class: 'a-score' }, h('span', null, h('b', { text: f1(v) }), ' / 5'), h('span', { class: 'mini' }, h('i', { class: v <= 2 ? 'neg' : v >= 4 ? 'pos' : 'mid', style: `width:${v * 20}%` }))),
          h('td', { class: 'a-frag' }, frag ? h('q', null, highlight(frag, q)) : h('span', { class: 'muted', text: '—' })),
          h('td', { class: 'a-expl', text: explanation(r.ev && r.ev[i]) }));
      })))),
    h('h3', { class: 'sub-title', text: 'Explicación general' }),
    h('p', { class: 'general', text: explainReview(r) }),
  ].filter(Boolean);
}
