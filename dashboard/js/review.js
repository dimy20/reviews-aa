// Cómo se muestra una reseña con su análisis. Lo usan el Resumen y la página de Reseñas.
import { DIMS } from './data.js';
import { h, icon, stars, f1, dayLabel, highlight, DIM_ICON } from './ui.js';
import { fragment, explainReview } from './metrics.js';

export function metaLine(r) {
  return [r.t != null ? dayLabel(r.t) : '', r.source, r.lang ? r.lang.toUpperCase() : ''].filter(Boolean).join(' · ');
}

// Estrellas, fecha, origen, idioma y nombre.
export function reviewMeta(r, size = 18) {
  return h('div', { class: 'meta' },
    r.rating ? stars(r.rating, size) : h('span', { class: 'no-rating', text: 'Sin estrellas' }),
    h('span', { text: metaLine(r) }),
    r.name ? h('span', { text: `· ${r.name}` }) : null);
}

// Tabla con el puntaje de cada aspecto y la explicación general.
export function reviewAnalysis(r, q = '') {
  if (r.pending) {
    return [h('div', { class: 'notice' }, icon('clock', 18), h('span', { text: 'Esta reseña llegó desde el formulario y todavía no pasó por el modelo. Cuando la API la procese, acá vas a ver el puntaje y la explicación de cada aspecto.' }))];
  }
  return [
    h('h3', { class: 'sub-title', text: 'Análisis por aspecto' }),
    h('div', { class: 'table-scroll' }, h('table', { class: 'asp-table' },
      h('thead', null, h('tr', null, ['Aspecto', 'Puntuación', 'Fragmento', 'Explicación'].map((t) => h('th', { text: t })))),
      h('tbody', null, DIMS.map((d, i) => {
        const v = r.s[i];
        const name = h('td', { class: 'a-name' }, icon(DIM_ICON[i], 18), d.label);
        if (!v) return h('tr', { class: 'na' }, name, h('td', { colspan: 3, text: 'No lo menciona (N/A)' }));
        const frag = fragment(r.text, i);
        return h('tr', null, name,
          h('td', { class: 'a-score' }, h('span', null, h('b', { text: f1(v) }), ' / 5'), h('span', { class: 'mini' }, h('i', { class: v <= 2 ? 'neg' : v >= 4 ? 'pos' : 'mid', style: `width:${v * 20}%` }))),
          h('td', { class: 'a-frag' }, frag ? h('q', null, highlight(frag, q)) : h('span', { class: 'muted', text: '—' })),
          h('td', { class: 'a-expl', text: (r.ev && r.ev[i]) || '—' }));
      })))),
    h('h3', { class: 'sub-title', text: 'Explicación general' }),
    h('p', { class: 'general', text: explainReview(r) }),
  ];
}
