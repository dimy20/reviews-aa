"""El pipeline de una reseña, de punta a punta. POST /reviews/analyze lo corre de fondo, después
de responderle al cliente.

    texto original ─► fastText ─► (si es es/pt) Hy-MT2 al inglés ─► kev puntúa el inglés
          │                                                              │
          └──────────────────────────► Qwen ◄──────── puntajes ──────────┘
                                         │
                cita en el idioma original + explicación en español ─► base ─► dashboard

Cada paso guarda lo suyo apenas termina. Si uno falla, la reseña queda con status 'error' y el
motivo, y lo que ya se había hecho (idioma, traducción, puntajes) queda guardado.

Todo es async: mientras una reseña espera a OpenRouter o a kev, las otras avanzan.
"""
import asyncio
import logging

from api import db
from engine.explain import explain_kev_ratings
from engine.infra import provision_pod
from engine.lang import detect_lang
from engine.pipeline import kev_assing_ratings, translate_to_english

log = logging.getLogger("analyze")

# Tope para una reseña entera. Con kev ya prendido tarda unos segundos. Sin pod hay que sumar
# conseguir una GPU (hasta ~10 min si no hay libres) y que cargue kev (~3 min, hasta 10).
# Si se pasa de esto algo se colgó y es mejor marcarla como error.
TIMEOUT = 25 * 60


async def analyze(review_id: int, text: str) -> None:
    step = "inicio"
    try:
        async with asyncio.timeout(TIMEOUT):
            step = "pod de kev"
            # el pod de kev (lo crea si no hay ninguno) y le corre el plazo antes de que el
            # watcher lo borre. Llama a RunPod, que bloquea: va en otro hilo.
            pod = await asyncio.to_thread(provision_pod)

            step = "detección de idioma"
            lang = detect_lang(text)

            step = "traducción"
            text_en = text if lang == "en" else await translate_to_english(text, lang)
            await db.save_translation(review_id, lang, text_en)

            step = "kev"
            ratings = await kev_assing_ratings(text_en, pod)  # la traducción, no el original
            await db.save_scores(review_id, ratings)

            step = "explicación (Qwen)"
            explained = await explain_kev_ratings(text, ratings)  # el original, no la traducción
            await db.save_explanations(review_id, explained)
        log.info("reseña %d analizada (%s)", review_id, lang)
    except Exception as e:
        reason = f"se pasó de {TIMEOUT} s" if isinstance(e, TimeoutError) else (str(e) or type(e).__name__)
        log.exception("reseña %d: falló en %s", review_id, step)
        await db.mark_error(review_id, f"{step}: {reason}")
