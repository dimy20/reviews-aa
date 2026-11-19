// Métricas y textos derivados de las reseñas. Funciones puras: no tocan el DOM.
import { DIMS } from './data.js';

export const DAY = 864e5;
const maxOf = (arr) => arr.reduce((m, v) => (v > m ? v : m), -Infinity);
const minOf = (arr) => arr.reduce((m, v) => (v < m ? v : m), Infinity);

// ---------- Filtros ----------
export const DEFAULT_FILTERS = { period: 'all', lang: 'all', stars: 'all', rest: 'all' };

export function timeRange(rows) {
  const ts = rows.map((r) => r.t).filter((t) => t != null);
  return ts.length ? [minOf(ts), maxOf(ts)] : [null, null];
}

export function windowRange(f, maxT) {
  if (maxT == null || f.period === 'all') return null;
  const d = new Date(maxT);
  d.setUTCMonth(d.getUTCMonth() - Number(f.period));
  return [d.getTime() + DAY, maxT + DAY - 1];
}

function match(r, f) {
  if (f.lang !== 'all' && r.lang !== f.lang) return false;
  if (f.rest !== 'all' && r.rest !== f.rest) return false;
  if (f.stars !== 'all') {
    if (!r.rating) return false;
    if (f.stars === 'high' && r.rating < 4) return false;
    if (f.stars === 'mid' && r.rating !== 3) return false;
    if (f.stars === 'low' && r.rating > 2) return false;
  }
  return true;
}

export function applyFilters(rows, f, maxT) {
  const base = rows.filter((r) => match(r, f));
  const w = windowRange(f, maxT);
  if (!w) return { cur: base, prev: null, win: null };
  const [a, b] = w, len = b - a;
  const cur = base.filter((r) => r.t != null && r.t >= a && r.t <= b);
  const prev = base.filter((r) => r.t != null && r.t >= a - len - 1 && r.t < a);
  return { cur, prev: prev.length >= 10 ? prev : null, win: w };
}

// ---------- Agregados ----------
export function compute(rows) {
  const st = {
    n: rows.length, rSum: 0, rN: 0, rDist: [0, 0, 0, 0, 0], anyNeg: 0, hidden: 0, rescue: 0, none: 0,
    dims: DIMS.map(() => ({ m: 0, sum: 0, dist: [0, 0, 0, 0, 0], neg: 0, pos: 0, mid: 0, rNeg: 0, rNegN: 0, rPos: 0, rPosN: 0 })),
  };
  for (const r of rows) {
    if (r.rating) { st.rSum += r.rating; st.rN++; st.rDist[r.rating - 1]++; }
    let neg = false, pos = false, any = false;
    for (let i = 0; i < DIMS.length; i++) {
      const v = r.s[i];
      if (!v) continue;
      any = true;
      const d = st.dims[i];
      d.m++; d.sum += v; d.dist[v - 1]++;
      if (v <= 2) { d.neg++; neg = true; if (r.rating) { d.rNeg += r.rating; d.rNegN++; } }
      else if (v >= 4) { d.pos++; pos = true; if (r.rating) { d.rPos += r.rating; d.rPosN++; } }
      else d.mid++;
    }
    if (!any) st.none++;
    if (neg) st.anyNeg++;
    if (neg && r.rating >= 4) st.hidden++;
    if (pos && r.rating && r.rating <= 2) st.rescue++;
  }
  st.avgR = st.rN ? st.rSum / st.rN : null;
  st.dims.forEach((d, i) => {
    d.i = i;
    d.avg = d.m ? d.sum / d.m : null;
    d.mention = st.n ? d.m / st.n : 0;
    d.negAll = st.n ? d.neg / st.n : 0;
    d.negMent = d.m ? d.neg / d.m : 0;
    d.posMent = d.m ? d.pos / d.m : 0;
    d.midMent = d.m ? d.mid / d.m : 0;
    d.starsNeg = d.rNegN >= 3 ? d.rNeg / d.rNegN : null;
    d.starsPos = d.rPosN >= 3 ? d.rPos / d.rPosN : null;
    d.impact = d.starsNeg != null && d.starsPos != null ? d.starsPos - d.starsNeg : null;
    d.priority = d.negAll * (d.impact != null ? Math.max(0.5, d.impact) : 1);
  });
  const withM = st.dims.filter((d) => d.m);
  st.avgDims = withM.length ? withM.reduce((s, d) => s + d.sum, 0) / withM.reduce((s, d) => s + d.m, 0) : null;
  return st;
}

// Aspectos con menciones suficientes para sacar conclusiones.
export const reliable = (st) => st.dims.filter((d) => d.m >= Math.max(5, st.n * 0.03));
export const weakest = (st) => [...reliable(st)].sort((a, b) => a.avg - b.avg)[0] || null;
export const strongest = (st) => [...reliable(st)].sort((a, b) => b.avg - a.avg)[0] || null;
export const priorities = (st) => st.dims.filter((d) => d.neg >= 3).sort((a, b) => b.priority - a.priority);

const avgOf = (rows, i, min = 5) => {
  let s = 0, n = 0;
  for (const r of rows) if (r.s[i]) { s += r.s[i]; n++; }
  return n >= min ? s / n : null;
};

// Cambio del promedio del aspecto: contra el período anterior si existe;
// si se ve todo el historial, últimos 12 meses contra los 12 anteriores.
export function trend(cur, prev, i) {
  if (prev) {
    const a = avgOf(cur, i), b = avgOf(prev, i);
    return a != null && b != null ? { d: a - b, basis: 'vs. período anterior' } : null;
  }
  const [, end] = timeRange(cur);
  if (end == null) return null;
  const y = 365.25 * DAY;
  const a = avgOf(cur.filter((r) => r.t != null && r.t > end - y), i);
  const b = avgOf(cur.filter((r) => r.t != null && r.t <= end - y && r.t > end - 2 * y), i);
  return a != null && b != null ? { d: a - b, basis: 'últimos 12 meses vs. 12 anteriores' } : null;
}

// ---------- Series en el tiempo ----------
const monthFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
export function buckets(rows) {
  const ts = rows.map((r) => r.t).filter((t) => t != null);
  if (ts.length < 2) return null;
  const a = minOf(ts), b = maxOf(ts);
  const months = (b - a) / (30.44 * DAY);
  const gran = months <= 18 ? 'month' : months <= 72 ? 'quarter' : 'year';
  const step = gran === 'year' ? 12 : gran === 'quarter' ? 3 : 1;
  const keyOf = (t) => {
    const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
    return y * 12 + Math.floor(m / step) * step;
  };
  const k0 = keyOf(a), k1 = keyOf(b);
  if (k0 === k1) return null;
  const list = [];
  for (let k = k0; k <= k1; k += step) list.push({ k, rows: [] });
  for (const r of rows) if (r.t != null) list[(keyOf(r.t) - k0) / step].rows.push(r);
  const label = (k) => {
    const y = Math.floor(k / 12), m = k % 12;
    if (gran === 'year') return String(y);
    if (gran === 'quarter') return `T${m / 3 + 1} ${String(y).slice(2)}`;
    return monthFmt.format(Date.UTC(y, m, 1)).replace('.', '');
  };
  return { gran, list: list.map((x) => ({ label: label(x.k), rows: x.rows })) };
}

// ---------- Qué impulsa cada aspecto ----------
// Grupos de palabras (en/es/pt) por aspecto. Se buscan en el texto y en el original.
const DRIVERS = [
  [ // Comida
    ['sabor', 'flavou?r\\w*|tast\\w*|sabor\\w*|gostos\\w*|saboros\\w*|delici\\w*|delíci\\w*'],
    ['frescura', 'fresh\\w*|fresc\\w*|stale|ranci\\w*|velh[oa]s?'],
    ['dulzor', 'sweet\\w*|dulce\\w*|doces?|azúcar|açúcar|sugar\\w*'],
    ['insípido', 'bland|insípid\\w*|sos[oa]s?|sem gosto|sin sabor'],
    ['porciones', 'portions?|porci[oó]n\\w*|porç\\w*|tamaño|tamanho|small|pequeñ\\w*|pequen\\w*'],
    ['temperatura', 'cold|frí[oa]s?|fri[oa]s?|calient\\w*|quente\\w*|derretid\\w*|melted|warm'],
    ['calidad', 'quality|calidad|qualidade'],
    ['variedad', 'variet\\w*|selection|variedad\\w*|variedade\\w*|opciones|opç\\w*'],
  ],
  [ // Espera
    ['filas', 'lines?|queue\\w*|filas?|colas?'],
    ['demora', 'slow\\w*|lent[oa]s?|demor\\w*|took (?:forever|so long|long)|tard(?:ó|aron|ou|aram)'],
    ['tiempo de espera', '!minutes?|minutos?|hours?|horas?|wait\\w*|espera\\w*'],
    ['rapidez', 'quick\\w*|fast|rápid\\w*|veloz|ágil\\w*|agil\\w*'],
    ['local lleno', 'crowd\\w*|busy|llen[oa]s?|lotad[oa]s?|chei[oa]s?|concurrid\\w*'],
  ],
  [ // Atención
    ['amabilidad', 'friendly|kind|amabl\\w*|simpátic\\w*|gentil\\w*|gentis|atencios\\w*|cordial\\w*'],
    ['mal trato', 'rude\\w*|groser\\w*|grosseir\\w*|mal-?educad\\w*|maleducad\\w*|unfriendly|antipátic\\w*'],
    ['personal', '!staff|employees?|workers?|emplead\\w*|funcionári\\w*|personal|equipe'],
    ['ayuda', 'helpful|prestativ\\w*|ayud\\w*|ajud\\w*'],
    ['dueños', 'owners?|dueñ\\w*|propietari\\w*|propriet\\w*'],
    ['caja y pedidos', 'cashiers?|cajer\\w*|caix\\w*|orders?|pedid\\w*'],
  ],
  [ // Precio
    ['caro', 'expensive|pricey|pricy|overpriced|car[oa]s?|carísim\\w*|costos[oa]s?'],
    ['precio', '!prices?|precios?|preços?'],
    ['barato', 'cheap\\w*|barat\\w*|affordable|económic\\w*|econômic\\w*|accesibles?'],
    ['calidad-precio', 'worth\\w*|value|vale la pena|vale a pena|calidad-precio|custo-benefício'],
    ['porciones', 'portions?|porci[oó]n\\w*|porç\\w*|small|pequeñ\\w*|pequen\\w*'],
    ['promociones', 'deals?|discounts?|promo\\w*|descuent\\w*|descont\\w*|ofert\\w*|coupons?|cup[oó]n\\w*|cupom'],
    ['cargos y propinas', 'tips?|propinas?|gorjetas?|fees?|cargos?|taxas?'],
  ],
  [ // Experiencia
    ['ambiente', 'atmosphere|ambiance|ambience|vibe\\w*|ambiente'],
    ['limpieza', 'clean\\w*|dirty|filthy|limpi\\w*|limp[oa]s?|suci\\w*|suj[oa]s?|suje\\w*'],
    ['decoración', 'decor\\w*|decoraci\\w*|decoraç\\w*'],
    ['volvería', 'come back|go back|return\\w*|volver\\w*|volvería|voltar\\w*|voltaria'],
    ['recomendación', 'recommend\\w*|recomiend\\w*|recomend\\w*'],
    ['estacionamiento', 'parking|estacionamient\\w*|estacionar|estacionamento'],
    ['espacio y mesas', 'seating|seats?|tables?|mesas?|asientos?|espacio|espaço|sillas?|cadeiras?'],
    ['ruido', 'noisy|loud|ruid\\w*|barulh\\w*'],
    ['ubicación', 'location|ubicaci\\w*|localiza\\w*'],
  ],
].map((groups) => groups.map(([label, src]) => {
  // '!' marca la palabra genérica del aspecto: sirve para encontrar el fragmento, no como "qué impulsa".
  const generic = src.startsWith('!');
  const body = generic ? src.slice(1) : src;
  return { label, generic, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'iu') };
}));

const ASPECT_RE = DRIVERS.map((groups) => new RegExp(groups.map((g) => g.re.source).join('|'), 'iu'));

// Palabras que más se repiten en las reseñas donde el aspecto es negativo (o positivo).
export function drivers(rows, i, polarity) {
  const counts = new Map();
  let n = 0;
  for (const r of rows) {
    const v = r.s[i];
    if (!v || (polarity === 'neg' ? v > 2 : v < 4)) continue;
    n++;
    const text = r.orig ? `${r.text}\n${r.orig}` : r.text;
    for (const g of DRIVERS[i]) if (!g.generic && g.re.test(text)) counts.set(g.label, (counts.get(g.label) || 0) + 1);
  }
  return [...counts].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([label, c]) => ({ label, c, share: c / n }));
}

const ACTIONS = [
  { sabor: 'Probar y ajustar las recetas de los productos con más quejas de sabor.',
    frescura: 'Controlar la rotación y frescura de los productos en exhibición.',
    dulzor: 'Revisar el nivel de azúcar de los productos señalados como demasiado dulces.',
    insípido: 'Revisar la sazón de los platos descriptos como insípidos.',
    porciones: 'Revisar el tamaño de las porciones de los platos más mencionados.',
    temperatura: 'Controlar la temperatura a la que salen los platos.',
    calidad: 'Revisar insumos y proveedores de los productos peor valorados.',
    variedad: 'Evaluar sumar opciones en las categorías más pedidas.',
    _: 'Revisar los platos que más aparecen en las reseñas negativas.' },
  { filas: 'Reforzar el personal en los horarios con más fila.',
    demora: 'Medir el tiempo entre pedido y entrega para encontrar el cuello de botella.',
    'tiempo de espera': 'Informar el tiempo estimado de espera al tomar el pedido.',
    rapidez: 'Mantener en hora pico los procesos que hoy hacen rápido el servicio.',
    'local lleno': 'Ofrecer pedido anticipado o para llevar en los horarios de más demanda.',
    _: 'Revisar la organización del servicio en los horarios de más demanda.' },
  { amabilidad: 'Reconocer al equipo en las reseñas que lo elogian y replicar esas prácticas.',
    'mal trato': 'Revisar los casos de mal trato y capacitar al equipo en atención al cliente.',
    personal: 'Dar seguimiento a las reseñas que nombran al personal.',
    ayuda: 'Asegurar que el equipo pueda orientar sobre el menú y las opciones.',
    dueños: 'Responder en persona las reseñas que mencionan a los dueños.',
    'caja y pedidos': 'Revisar el proceso de caja y toma de pedidos.',
    _: 'Capacitar al equipo en trato y comunicación con el cliente.' },
  { caro: 'Comparar el precio de los productos más criticados con la competencia.',
    precio: 'Revisar la estructura de precios de los productos más mencionados.',
    barato: 'Destacar en la comunicación los productos con mejor precio.',
    'calidad-precio': 'Comunicar mejor qué incluye cada producto para reforzar su valor.',
    porciones: 'Revisar el tamaño de las porciones en relación con su precio.',
    promociones: 'Evaluar combos o promociones en los productos con más quejas de precio.',
    'cargos y propinas': 'Aclarar cargos extra y propinas antes de cobrar.',
    _: 'Revisar precios y porciones de los productos con más quejas.' },
  { ambiente: 'Revisar iluminación, música y comodidad del salón.',
    limpieza: 'Reforzar la limpieza del salón, las mesas y los baños.',
    decoración: 'Mantener y renovar la decoración que los clientes valoran.',
    volvería: 'Fidelizar a quienes dicen que volverían (novedades, beneficios).',
    recomendación: 'Invitar a los clientes satisfechos a dejar su reseña.',
    estacionamiento: 'Informar opciones de estacionamiento cercanas.',
    'espacio y mesas': 'Revisar la cantidad y la distribución de mesas.',
    ruido: 'Reducir el ruido del salón en hora pico.',
    ubicación: 'Mejorar la señalización para llegar al local.',
    _: 'Revisar la experiencia en el salón de punta a punta.' },
];

export function actionsFor(i, negDrivers) {
  const out = [];
  for (const d of negDrivers) {
    const a = ACTIONS[i][d.label];
    if (a && !out.includes(a)) out.push(a);
    if (out.length === 3) break;
  }
  if (out.length < 2) out.push(ACTIONS[i]._);
  return out;
}

// Frase de la reseña que menciona el aspecto (aproximación por palabras clave).
export function fragment(text, i) {
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const s = sentences.find((x) => ASPECT_RE[i].test(x));
  if (!s) return '';
  return s.length > 150 ? s.slice(0, 147).trimEnd() + '…' : s;
}

const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Resumen en una o dos frases a partir de los puntajes.
export function explainReview(r) {
  const pos = [], neg = [], mid = [];
  r.s.forEach((v, i) => { if (v >= 4) pos.push(DIMS[i].art); else if (v && v <= 2) neg.push(DIMS[i].art); else if (v === 3) mid.push(DIMS[i].art); });
  if (!pos.length && !neg.length && !mid.length) return 'La reseña no menciona ninguno de los cinco aspectos.';
  const parts = [];
  if (pos.length) parts.push(`valora bien ${list(pos)}`);
  if (neg.length) parts.push(`critica ${list(neg)}`);
  if (mid.length) parts.push(`tiene una opinión mixta sobre ${list(mid)}`);
  let out = cap(parts.join('; ')) + '.';
  if (r.rating >= 4 && neg.length) out += ` Aunque puso ${r.rating} estrellas, hay una queja que la nota global no muestra.`;
  if (r.rating && r.rating <= 2 && pos.length) out += ` Pese a la nota baja, rescata ${list(pos)}.`;
  return out;
}
