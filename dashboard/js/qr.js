// Código QR del formulario público, para mostrarlo en pantalla y que la gente lo escanee.
import { CONFIG } from './config.js';
import { h, icon } from './ui.js';

// js/vendor/qrcode.js (qrcode-generator, MIT) no es un módulo: define la global `qrcode`.
// Se carga recién la primera vez que se abre el QR.
let lib;
function loadLib() {
  lib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/qrcode.js';
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => reject(new Error('No se pudo cargar js/vendor/qrcode.js'));
    document.head.append(s);
  });
  return lib;
}

const isLocal = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

// La dirección pública del túnel de ngrok, si está corriendo (nginx se la pregunta al agente).
async function tunnelUrl() {
  try {
    const res = await fetch('public-url', { headers: { Accept: 'application/json' } });
    if (!res.ok) return '';
    const tunnels = (await res.json()).tunnels || [];
    return (tunnels.find((t) => t.public_url.startsWith('https://')) || tunnels[0])?.public_url || '';
  } catch { return ''; }
}

// La dirección del formulario como la tiene que abrir un teléfono. En orden: la configurada
// (PUBLIC_URL); si el dashboard está abierto en localhost, la del túnel de ngrok; y si no,
// la misma con la que se abrió el dashboard.
export async function formUrl() {
  const base = CONFIG.publicUrl || (isLocal(location.href) && await tunnelUrl()) || '';
  return new URL(CONFIG.publicForm, base ? `${base.replace(/\/+$/, '')}/` : location.href).href;
}

export async function showQr() {
  const url = await formUrl();
  const qrcode = await loadLib();
  const qr = qrcode(0, 'M');  // 0 = el tamaño mínimo que alcance; M = tolera ~15% de daño
  qr.addData(url);
  qr.make();

  const code = h('div', { class: 'qr-code', role: 'img', 'aria-label': `Código QR de ${url}` });
  code.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });  // SVG de la librería, sin texto del usuario

  const dialog = h('dialog', { class: 'qr-dialog', 'aria-label': 'Código QR del formulario' },
    h('button', { class: 'qr-close', type: 'button', 'aria-label': 'Cerrar', onclick: () => dialog.close() }, icon('x', 22)),
    h('p', { class: 'qr-eyebrow', text: CONFIG.restaurant }),
    h('h2', { text: 'Dejanos tu reseña' }),
    h('p', { class: 'qr-lead', text: 'Escaneá el código con la cámara del teléfono.' }),
    code,
    h('p', { class: 'qr-url', text: url.replace(/^https?:\/\//, '') }),
    isLocal(url) ? h('p', { class: 'qr-warn', text: 'Este código apunta a esta computadora: desde otro teléfono no va a abrir. Para que funcione, el túnel público (ngrok) tiene que estar corriendo.' }) : null);

  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });  // clic afuera
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
