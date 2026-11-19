"""Los pasos del pipeline que no son la explicación (esa está en engine/explain.py):

    detect_lang          engine/lang.py   fastText
    translate_to_english                  Hy-MT2 por OpenRouter, solo si la reseña es es/pt
    kev_assing_ratings                    kev en el pod de RunPod (hoy el BASE; falta el fine-tuneado, ver KEV_MODEL)

Todo es async: la API los encadena para muchas reseñas a la vez (api/analyze.py).
"""
import asyncio
import logging
import time
from functools import lru_cache
from typing import Literal, TypedDict

import httpx
from typesafe_sdk import AsyncTypeSafeClient, Choice

from engine.aspects import CRITERIA, load_aspects
from engine.explain import DIMS
from engine.infra import PodResource
from engine.openrouter import openrouter
from settings import get_settings

log = logging.getLogger("pipeline")

TRANSLATION_MODEL = "tencent/hy-mt2-1.8b"  # el mejor en notebooks/03_traductor_pipeline/

Rating = Literal["1", "2", "3", "4", "5", "N/A"]  # kev devuelve los puntajes como strings


class KevRatings(TypedDict):
    food: Rating
    wait_time: Rating
    service: Rating
    price: Rating
    experience: Rating


# ---------------------------------------------------------------------------
# Traducción
# ---------------------------------------------------------------------------
async def translate_to_english(text: str, src: Literal["es", "pt"]) -> str:
    """Traduce una reseña en español o portugués al inglés, que es lo que lee kev.

    Prompt y parámetros iguales a los de notebooks/03_traductor_pipeline/02_traducir_splits_hymt.ipynb
    (los recomendados por Hy-MT2): con ese mismo traductor se armaron los datos con que se
    fine-tuneó kev, así kev recibe traducciones del mismo estilo que las que vio.
    """
    if src not in ("es", "pt"):
        raise ValueError(f"Solo se traduce desde es o pt, no desde {src!r}")

    prompt = (
        "Translate the following text into English. Note that you should "
        "only output the translated result without any additional explanation:\n\n" + text
    )
    res = await openrouter().chat.send_async(
        model=TRANSLATION_MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2048,
        temperature=0.7,
        top_p=0.6,
        top_k=20,
        repetition_penalty=1.05,
    )
    content = res.choices[0].message.content
    if not content or not content.strip():
        raise RuntimeError("Hy-MT2 devolvió una traducción vacía")
    return content.strip()


# ---------------------------------------------------------------------------
# kev
# ---------------------------------------------------------------------------
# PENDIENTE: el kev FINE-TUNEADO.
# Hoy se usa el kev BASE que sirve el pod (imagen de infra.yaml, modelo "kev-latest").
# El fine-tuneado (entrenado con reseñas/splits_en/kev/*.jsonl) lo agrega otra persona: cuando
# esté, cambiar KEV_MODEL por el nombre del modelo tuneado, o la imagen/volumen en infra.yaml
# si el tuneado se sirve desde otro pod. El resto del pipeline no cambia: kev_assing_ratings
# tiene que seguir devolviendo "1"-"5" o "N/A" por aspecto.
KEV_MODEL = "kev-latest"

KEV_BOOT_TIMEOUT = 10 * 60  # s: un pod recién creado tarda unos minutos en cargar kev
KEV_POLL_INTERVAL = 10      # s entre cada /ping mientras carga
KEV_RETRIES = 3             # intentos si kev falla (a veces el primero da 502 aunque /ping ya dé 200)

# Es una sola GPU: como mucho 4 reseñas en kev a la vez, el resto espera su turno.
_KEV_SLOTS = asyncio.Semaphore(4)


@lru_cache
def _questions() -> dict:
    """Las 5 preguntas que se le hacen a kev, una por aspecto (engine/instructions/)."""
    aspects = load_aspects()
    return {d: Choice(instructions=aspects[d], criteria=CRITERIA) for d in DIMS}


@lru_cache
def _kev_client(base_url: str) -> AsyncTypeSafeClient:
    """Un cliente por pod, reusado por todas las reseñas."""
    return AsyncTypeSafeClient(
        api_key=get_settings().kev_api_key,
        base_url=base_url,
        model=KEV_MODEL,
        compression=False,  # kev.serve no sabe leer bodies comprimidos con zstd
        timeout=120,
    )


async def wait_until_kev_ready(health_url: str) -> None:
    """Espera a que /ping dé 200. Con el pod ya prendido es una sola consulta; con un pod
    recién creado, espera a que cargue kev (unos 3 minutos)."""
    deadline = time.monotonic() + KEV_BOOT_TIMEOUT
    async with httpx.AsyncClient(timeout=10) as http:
        while True:
            try:
                if (await http.get(health_url)).status_code == 200:
                    return
            except httpx.HTTPError:
                pass  # todavía no levantó el servidor
            if time.monotonic() > deadline:
                raise RuntimeError(f"no respondió en {KEV_BOOT_TIMEOUT // 60} minutos ({health_url})")
            log.info("kev todavía cargando, espero %d s...", KEV_POLL_INTERVAL)
            await asyncio.sleep(KEV_POLL_INTERVAL)


async def kev_assing_ratings(review_en: str, pod: PodResource) -> KevRatings:
    """Recibe la reseña EN INGLÉS (ya traducida si hacía falta) y el pod (de provision_pod), y
    devuelve el puntaje de cada aspecto: "1"-"5" o "N/A"."""
    await wait_until_kev_ready(pod["health_url"])
    client = _kev_client(pod["base_url"])

    async with _KEV_SLOTS:
        for attempt in range(1, KEV_RETRIES + 1):
            try:
                response = await client.system_one(state=review_en, questions=_questions())
                break
            except Exception as e:
                if attempt == KEV_RETRIES:
                    raise RuntimeError(f"falló {KEV_RETRIES} veces: {e}") from e
                log.warning("kev falló (%s), reintento en 10 s", e)
                await asyncio.sleep(10)

    return {d: response.answers[d].choice for d in DIMS}
