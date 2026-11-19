// Formulario público para dejar una reseña.
import { CONFIG } from './config.js';
import { submitReview } from './api.js';
import { $, h, img } from './ui.js';

const MIN = 15, MAX = 2000;

const T = {
  es: {
    eyebrow: 'Dejá tu reseña', title: '¿Cómo fue tu visita?',
    lead: `Tu opinión ayuda a ${CONFIG.restaurant} a mejorar. Te lleva un minuto.`,
    rating: 'Tu calificación', optional: 'opcional',
    levels: ['Sin calificar', 'Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'], clear: 'Quitar',
    review: 'Tu reseña', ph: 'Contanos qué pediste, cómo te atendieron, cuánto esperaste, qué te pareció el precio y cómo fue la experiencia…',
    topics: 'Podés contar sobre', topicList: ['la comida', 'la espera', 'la atención', 'el precio', 'la experiencia'],
    name: 'Tu nombre', send: 'Enviar reseña', sending: 'Enviando…',
    privacy: 'No pedimos email ni teléfono. Tu reseña se analiza de forma automática para ayudar al restaurante a mejorar.',
    short: `Escribí al menos ${MIN} caracteres.`, error: 'No pudimos enviar la reseña. Probá de nuevo en unos minutos.',
    thanks: '¡Gracias por tu reseña!', thanksLead: `La recibimos y el equipo de ${CONFIG.restaurant} la va a leer.`, again: 'Escribir otra reseña',
    star: (n) => `${n} ${n === 1 ? 'estrella' : 'estrellas'}`, by: 'Con la tecnología de',
  },
  pt: {
    eyebrow: 'Deixe sua avaliação', title: 'Como foi a sua visita?',
    lead: `Sua opinião ajuda ${CONFIG.restaurant} a melhorar. Leva um minuto.`,
    rating: 'Sua nota', optional: 'opcional',
    levels: ['Sem nota', 'Muito ruim', 'Ruim', 'Regular', 'Boa', 'Excelente'], clear: 'Remover',
    review: 'Sua avaliação', ph: 'Conte o que você pediu, como foi o atendimento, quanto esperou, o que achou do preço e como foi a experiência…',
    topics: 'Você pode falar sobre', topicList: ['a comida', 'a espera', 'o atendimento', 'o preço', 'a experiência'],
    name: 'Seu nome', send: 'Enviar avaliação', sending: 'Enviando…',
    privacy: 'Não pedimos e-mail nem telefone. Sua avaliação é analisada automaticamente para ajudar o restaurante a melhorar.',
    short: `Escreva pelo menos ${MIN} caracteres.`, error: 'Não conseguimos enviar a avaliação. Tente novamente em alguns minutos.',
    thanks: 'Obrigado pela sua avaliação!', thanksLead: `Recebemos e a equipe de ${CONFIG.restaurant} vai ler.`, again: 'Escrever outra avaliação',
    star: (n) => `${n} ${n === 1 ? 'estrela' : 'estrelas'}`, by: 'Com a tecnologia de',
  },
  en: {
    eyebrow: 'Leave a review', title: 'How was your visit?',
    lead: `Your feedback helps ${CONFIG.restaurant} improve. It only takes a minute.`,
    rating: 'Your rating', optional: 'optional',
    levels: ['Not rated', 'Very bad', 'Bad', 'Okay', 'Good', 'Excellent'], clear: 'Clear',
    review: 'Your review', ph: 'Tell us what you ordered, how the service was, how long you waited, and what you thought of the price and the overall experience…',
    topics: 'You can mention', topicList: ['the food', 'the wait', 'the service', 'the price', 'the experience'],
    name: 'Your name', send: 'Send review', sending: 'Sending…',
    privacy: 'We don’t ask for your email or phone. Your review is analyzed automatically to help the restaurant improve.',
    short: `Please write at least ${MIN} characters.`, error: 'We couldn’t send your review. Please try again in a few minutes.',
    thanks: 'Thank you for your review!', thanksLead: `We got it and the ${CONFIG.restaurant} team will read it.`, again: 'Write another review',
    star: (n) => `${n} ${n === 1 ? 'star' : 'stars'}`, by: 'Powered by',
  },
};

// Español por defecto; ?lang=pt o ?lang=en abre el formulario en otro idioma.
const asked = new URLSearchParams(location.search).get('lang');
let lang = T[asked] ? asked : 'es';
let rating = 0;
let sent = false;

const STAR = '<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/>';
function starBtn(n) {
  const b = h('button', { type: 'button', class: 'star-btn', role: 'radio', 'data-n': n });
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = STAR;
  b.append(s);
  b.addEventListener('click', () => { rating = rating === n ? 0 : n; paintStars(); });
  b.addEventListener('mouseenter', () => paintStars(n));
  b.addEventListener('focus', () => paintStars(n));
  b.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); rating = Math.min(5, rating + 1); paintStars(); focusStar(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); rating = Math.max(0, rating - 1); paintStars(); focusStar(); }
  });
  return b;
}
const focusStar = () => $(`.star-btn[data-n="${Math.max(1, rating)}"]`).focus();

function paintStars(hover) {
  const t = T[lang];
  const show = hover ?? rating;
  document.querySelectorAll('.star-btn').forEach((b) => {
    const n = Number(b.dataset.n);
    b.classList.toggle('on', n <= show);
    b.setAttribute('aria-checked', String(n === rating));
    b.setAttribute('aria-label', t.star(n));
    b.tabIndex = n === Math.max(1, rating) ? 0 : -1;
  });
  $('#rating-label').textContent = t.levels[show];
  $('#rating-clear').hidden = !rating;
}

function applyLang() {
  const t = T[lang];
  document.documentElement.lang = lang;
  document.title = `${t.eyebrow} · ${CONFIG.restaurant}`;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t[el.dataset.t];
  $('#text').placeholder = t.ph;
  $('#topics').replaceChildren(h('span', { text: `${t.topics}:` }), ...t.topicList.map((x) => h('span', { class: 'topic', text: x })));
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  $('#send').textContent = t.send;
  paintStars();
  count();
}

function count() {
  const n = $('#text').value.length;
  $('#count').textContent = `${n} / ${MAX}`;
}

// ---------- Montaje ----------
$('#rest-name').textContent = CONFIG.restaurant;
$('#brand').textContent = CONFIG.appName;
$('#hero-img').append(img('img/brownie-torre.webp'));
$('#stars').append(...[1, 2, 3, 4, 5].map(starBtn));
$('#stars').addEventListener('mouseleave', () => paintStars());
$('#rating-clear').addEventListener('click', () => { rating = 0; paintStars(); });
$('#text').maxLength = MAX;
$('#text').addEventListener('input', () => { count(); $('#err').hidden = true; });
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; applyLang(); }));

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (sent) return;
  const t = T[lang];
  const text = $('#text').value.trim();
  const err = $('#err');
  if ($('#website').value) return; // trampa para bots
  if (text.length < MIN) { err.textContent = t.short; err.hidden = false; $('#text').focus(); return; }
  const btn = $('#send');
  btn.disabled = true; btn.textContent = t.sending;
  try {
    await submitReview({ text, rating, name: $('#name').value.trim(), lang });
    sent = true;
    $('#form').hidden = true;
    $('#thanks').hidden = false;
    $('#thanks').focus();
  } catch (ex) {
    console.error(ex);
    err.textContent = t.error; err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = t.send;
  }
});

$('#again').addEventListener('click', () => {
  sent = false; rating = 0;
  $('#form').reset();
  $('#form').hidden = false;
  $('#thanks').hidden = true;
  applyLang();
  $('#text').focus();
});

applyLang();
