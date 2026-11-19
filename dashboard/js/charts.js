// Gráfico de líneas en SVG (sin librerías) y tooltip compartido.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function tipEl() {
  let t = document.getElementById('tip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'tip'; t.className = 'tip'; t.setAttribute('role', 'tooltip'); t.hidden = true;
    document.body.appendChild(t);
  }
  return t;
}

// rows: [{ color, label, value }] — el valor va primero, la etiqueta después.
export function showTip(evt, title, rows) {
  const tip = tipEl();
  tip.replaceChildren();
  if (title) {
    const t = document.createElement('div');
    t.className = 'tip-title'; t.textContent = title;
    tip.appendChild(t);
  }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    if (r.color) {
      const k = document.createElement('i');
      k.className = 'key'; k.style.background = r.color;
      row.appendChild(k);
    }
    const b = document.createElement('b');
    b.textContent = r.value;
    const n = document.createElement('span');
    n.textContent = r.label;
    row.append(b, n);
    tip.appendChild(row);
  }
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = evt.clientX + 14, top = evt.clientY - h - 12;
  if (left + w > innerWidth - 8) left = evt.clientX - w - 14;
  if (top < 8) top = evt.clientY + 16;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = top + 'px';
}

export function hideTip() { tipEl().hidden = true; }
addEventListener('scroll', hideTip, { passive: true });

// opts: { labels, series:[{label,color,values}], domain, ticks, fmt, extra(i), endLabel, height, aria }
export function lineChart(host, opts) {
  const { labels, series, domain, ticks, fmt, extra, endLabel, height = 240 } = opts;
  host.replaceChildren();
  const W = Math.max(260, host.clientWidth), H = height;
  const m = { t: 12, r: endLabel ? 38 : 12, b: 26, l: 34 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, n = labels.length;
  const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - ((v - domain[0]) / (domain[1] - domain[0])) * ih;

  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0,
    'aria-label': opts.aria || 'Gráfico de evolución. Usá las flechas para recorrer los períodos.' }, host);

  ticks.forEach((t, k) => {
    svgEl('line', { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), class: k === 0 ? 'base' : 'grid' }, svg);
    svgEl('text', { x: m.l - 8, y: y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, svg).textContent = fmt(t);
  });

  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 58))));
  const shown = labels.map((_, i) => i).filter((i) => i % every === 0);
  if (shown[shown.length - 1] !== n - 1) {
    if (n - 1 - shown[shown.length - 1] < every) shown.pop();
    shown.push(n - 1);
  }
  for (const i of shown) {
    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
    svgEl('text', { x: x(i), y: H - 6, class: 'tick', 'text-anchor': anchor }, svg).textContent = labels[i];
  }

  for (const s of series) {
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
      pen = true;
    });
    if (d) svgEl('path', { d, class: 'line', stroke: s.color }, svg);
    let last = -1;
    s.values.forEach((v, i) => { if (v != null) last = i; });
    s.values.forEach((v, i) => {
      if (v == null) return;
      const iso = s.values[i - 1] == null && s.values[i + 1] == null;
      if (iso || i === last) svgEl('circle', { cx: x(i), cy: y(s.values[i]), r: 4, fill: s.color, class: 'dot' }, svg);
    });
    if (endLabel && last >= 0) {
      svgEl('text', { x: x(last) + 8, y: y(s.values[last]) - 10, class: 'end-label' }, svg).textContent = fmt(s.values[last]);
    }
  }

  const cross = svgEl('line', { y1: m.t, y2: m.t + ih, class: 'cross', visibility: 'hidden' }, svg);
  const hl = series.map((s) => svgEl('circle', { r: 4, fill: s.color, class: 'dot', visibility: 'hidden' }, svg));
  const hit = svgEl('rect', { x: m.l - 10, y: 0, width: iw + 20, height: H, fill: 'transparent' }, svg);

  let cur = -1;
  const show = (i, evt) => {
    cur = i;
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    const rows = [];
    series.forEach((s, k) => {
      const v = s.values[i];
      if (v == null) { hl[k].setAttribute('visibility', 'hidden'); return; }
      hl[k].setAttribute('cx', x(i)); hl[k].setAttribute('cy', y(v)); hl[k].setAttribute('visibility', 'visible');
      rows.push({ color: s.color, label: s.label, value: fmt(v), v });
    });
    rows.sort((a, b) => b.v - a.v);
    if (!rows.length) rows.push({ label: 'pocas menciones en este período', value: '—' });
    showTip(evt, labels[i], rows.concat(extra ? extra(i) : []));
  };
  const hide = () => {
    cur = -1;
    cross.setAttribute('visibility', 'hidden');
    hl.forEach((c) => c.setAttribute('visibility', 'hidden'));
    hideTip();
  };
  const idxAt = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) * W) / r.width;
    return n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
  };
  hit.addEventListener('pointermove', (e) => show(idxAt(e), e));
  hit.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const i = cur < 0 ? (step > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, cur + step));
    const r = svg.getBoundingClientRect();
    show(i, { clientX: r.left + x(i) * (r.width / W), clientY: r.top + m.t + 30 });
  });
}

// Dominio y marcas del eje Y para puntajes 1–5, ajustado a los datos.
export function scoreAxis(series) {
  const vals = series.flatMap((s) => s.values.filter((v) => v != null));
  let lo = vals.length ? Math.max(1, Math.min(4, Math.floor(Math.min(...vals) * 2) / 2)) : 1;
  const step = 5 - lo > 2.5 ? 1 : 0.5;
  if (step === 1) lo = Math.floor(lo);
  const ticks = [];
  for (let t = lo; t <= 5.0001; t += step) ticks.push(Math.round(t * 10) / 10);
  return { domain: [lo, 5], ticks };
}
