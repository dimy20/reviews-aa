// Formulario público para dejar una reseña.
import { CONFIG } from './config.js';
import { submitReview } from './api.js';
import { $, h, img } from './ui.js';

const MIN = 15, MAX = 2000;

const T = {
  es: {
    eyebrow: 'Dejá tu reseña', title: '¿Cómo fue tu visita?',
    lead: `Tu opinión ayuda a ${CONFIG.restaurant} a mejorar. Te lleva un minuto.`,
    optional: 'opcional',
    review: 'Tu reseña', ph: 'Contanos qué pediste, cómo te atendieron, cuánto esperaste, qué te pareció el precio y cómo fue la experiencia…',
    topics: 'Podés contar sobre', topicList: ['la comida', 'la espera', 'la atención', 'el precio', 'la experiencia'],
    name: 'Tu nombre', send: 'Enviar reseña', sending: 'Enviando…',
    privacy: 'No pedimos email ni teléfono. Tu reseña se analiza de forma automática para ayudar al restaurante a mejorar.',
    short: `Escribí al menos ${MIN} caracteres.`, error: 'No pudimos enviar la reseña. Probá de nuevo en unos minutos.',
    thanks: '¡Gracias por tu reseña!', thanksLead: `La recibimos y el equipo de ${CONFIG.restaurant} la va a leer.`, again: 'Escribir otra reseña',
    by: 'Con la tecnología de',
  },
  pt: {
    eyebrow: 'Deixe sua avaliação', title: 'Como foi a sua visita?',
    lead: `Sua opinião ajuda ${CONFIG.restaurant} a melhorar. Leva um minuto.`,
    optional: 'opcional',
    review: 'Sua avaliação', ph: 'Conte o que você pediu, como foi o atendimento, quanto esperou, o que achou do preço e como foi a experiência…',
    topics: 'Você pode falar sobre', topicList: ['a comida', 'a espera', 'o atendimento', 'o preço', 'a experiência'],
    name: 'Seu nome', send: 'Enviar avaliação', sending: 'Enviando…',
    privacy: 'Não pedimos e-mail nem telefone. Sua avaliação é analisada automaticamente para ajudar o restaurante a melhorar.',
    short: `Escreva pelo menos ${MIN} caracteres.`, error: 'Não conseguimos enviar a avaliação. Tente novamente em alguns minutos.',
    thanks: 'Obrigado pela sua avaliação!', thanksLead: `Recebemos e a equipe de ${CONFIG.restaurant} vai ler.`, again: 'Escrever outra avaliação',
    by: 'Com a tecnologia de',
  },
  en: {
    eyebrow: 'Leave a review', title: 'How was your visit?',
    lead: `Your feedback helps ${CONFIG.restaurant} improve. It only takes a minute.`,
    optional: 'optional',
    review: 'Your review', ph: 'Tell us what you ordered, how the service was, how long you waited, and what you thought of the price and the overall experience…',
    topics: 'You can mention', topicList: ['the food', 'the wait', 'the service', 'the price', 'the experience'],
    name: 'Your name', send: 'Send review', sending: 'Sending…',
    privacy: 'We don’t ask for your email or phone. Your review is analyzed automatically to help the restaurant improve.',
    short: `Please write at least ${MIN} characters.`, error: 'We couldn’t send your review. Please try again in a few minutes.',
    thanks: 'Thank you for your review!', thanksLead: `We got it and the ${CONFIG.restaurant} team will read it.`, again: 'Write another review',
    by: 'Powered by',
  },
};

// Español por defecto; ?lang=pt o ?lang=en abre el formulario en otro idioma.
const asked = new URLSearchParams(location.search).get('lang');
let lang = T[asked] ? asked : 'es';
let sent = false;

function applyLang() {
  const t = T[lang];
  document.documentElement.lang = lang;
  document.title = `${t.eyebrow} · ${CONFIG.restaurant}`;
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t[el.dataset.t];
  $('#text').placeholder = t.ph;
  $('#topics').replaceChildren(h('span', { text: `${t.topics}:` }), ...t.topicList.map((x) => h('span', { class: 'topic', text: x })));
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  $('#send').textContent = t.send;
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
    await submitReview({ text, name: $('#name').value.trim() });
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
  sent = false;
  $('#form').reset();
  $('#form').hidden = false;
  $('#thanks').hidden = true;
  applyLang();
  $('#text').focus();
});

applyLang();
