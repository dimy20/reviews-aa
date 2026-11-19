"""Toma N reseñas al azar por idioma de un split, se las pasa a kev y guarda lo que devuelve.

Levanta el pod de kev (o reusa el que esté corriendo), espera a que cargue, puntúa y lo borra
al terminar. Lo que devuelve kev queda en qwen/data/kev_ratings.json, así las pruebas de prompts
con Qwen (qwen/run.py) no necesitan el pod prendido.

kev lee la traducción al inglés (text_en); Qwen después recibe el texto original (text).

    uv run python -m qwen.sample_kev                 # 3 en + 3 es + 3 pt de test, 20-80 palabras, seed 42
    uv run python -m qwen.sample_kev -n 5 --lang es  # 5 en español
    uv run python -m qwen.sample_kev --unlabeled     # de resenas_ingles.csv, sin etiqueta humana (solo en)
    uv run python -m qwen.sample_kev -n 4 --seed 7 --split val
    uv run python -m qwen.sample_kev --keep          # no borra el pod al terminar

Crear el pod empieza a cobrar la GPU.
"""
import argparse
import csv
import json
import logging
import random
import sys
import time

import httpx
import runpod
from typesafe_sdk import Choice, TypeSafeClient

from engine.aspects import CRITERIA, load_aspects
from engine.infra import provision_pod, terminate_kev_pods
from qwen.common import DATA_DIR, DIMS, KEV_RATINGS_PATH
from settings import ROOT, get_settings

log = logging.getLogger("sample_kev")

BOOT_TIMEOUT = 20 * 60  # s: kev tarda unos minutos en cargar
POLL_INTERVAL = 15


LANGS = ["en", "es", "pt"]


def pick_reviews(split: str, n: int, seed: int, langs: list[str], min_words: int, max_words: int) -> list[dict]:
    """n reseñas al azar de cada idioma de langs. El largo se mide sobre el texto original,
    que es lo que va a leer Qwen."""
    path = ROOT / "reseñas" / "splits_en" / f"{split}_en.csv"
    with open(path, encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if min_words <= len(r["text"].split()) <= max_words]
    rng = random.Random(seed)
    sample = []
    for lang in langs:
        pool = [r for r in rows if r["lang"] == lang]
        if len(pool) < n:
            raise SystemExit(f"Solo hay {len(pool)} reseñas en {lang} en {split} con esos filtros, pediste {n}")
        sample += rng.sample(pool, n)
    return [
        {
            "id": r["id"],
            "lang": r["lang"],
            "text": r["text"],
            "text_en": r["text_en"],
            "stars": r["rating_original"],
            # etiqueta humana; -1 es N/A en los splits
            "human": {d: "N/A" if r[d] == "-1" else r[d] for d in DIMS},
        }
        for r in sample
    ]


def pick_unlabeled(n: int, seed: int, min_words: int, max_words: int) -> list[dict]:
    """Reseñas de reseñas/resenas_ingles.csv que no están en ningún split: nadie las etiquetó y kev
    nunca las vio. No tienen etiqueta humana, solo las estrellas originales."""
    def norm(s: str) -> str:
        return " ".join(s.split())

    seen = set()
    for split in ("train", "val", "test"):
        with open(ROOT / "reseñas" / "splits_en" / f"{split}_en.csv", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                seen.add(norm(r["text"]))
                seen.add(norm(r["text_en"]))

    with open(ROOT / "reseñas" / "resenas_ingles.csv", encoding="utf-8") as f:
        rows = [
            (i, r) for i, r in enumerate(csv.DictReader(f))
            if norm(r["Review Text"]) not in seen and min_words <= len(r["Review Text"].split()) <= max_words
        ]
    sample = random.Random(seed).sample(rows, n)
    return [
        {
            "id": f"csv-{i}",  # número de fila en resenas_ingles.csv (sin contar el encabezado)
            "lang": "en",
            "text": r["Review Text"],
            "text_en": r["Review Text"],
            "stars": r["Rating"],
            "human": {d: "-" for d in DIMS},
        }
        for i, r in sample
    ]


def wait_until_healthy(health_url: str) -> None:
    start = time.time()
    while time.time() - start < BOOT_TIMEOUT:
        try:
            status = httpx.get(health_url, timeout=10).status_code
        except httpx.HTTPError as e:
            status = type(e).__name__
        if status == 200:
            log.info("kev listo (%ds)", time.time() - start)
            return
        log.info("kev todavía cargando (%s), espero %ds...", status, POLL_INTERVAL)
        time.sleep(POLL_INTERVAL)
    raise TimeoutError(f"kev no respondió 200 en {health_url} después de {BOOT_TIMEOUT}s")


def rate(client: TypeSafeClient, questions: dict, text: str) -> dict:
    # aunque /ping ya dé 200, el primer request a veces llega con 502: reintento un par de veces
    for attempt in range(3):
        try:
            response = client.system_one(state=text, questions=questions)
            break
        except Exception as e:
            if attempt == 2:
                raise
            log.warning("kev falló (%s), reintento en 10s", e)
            time.sleep(10)
    return {
        dim: {
            "choice": a.choice,
            "confidence": round(a.confidence, 3),
            "probabilities": {k: round(v, 3) for k, v in a.probabilities.items()},
        }
        for dim, a in response.answers.items()
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-n", type=int, default=3, help="cantidad de reseñas por idioma (default 3)")
    parser.add_argument("--seed", type=int, default=42)
    # test: kev nunca la vio (ni en el fine-tuning ni para elegir checkpoint)
    parser.add_argument("--split", choices=["train", "val", "test"], default="test")
    parser.add_argument("--unlabeled", action="store_true",
                        help="sacarlas de resenas_ingles.csv, de las que no están en ningún split (sin etiqueta humana)")
    parser.add_argument("--lang", default="all", help="idioma original: en | es | pt | all (default all: n de cada uno)")
    parser.add_argument("--min-words", type=int, default=20, help="largo mínimo del texto original (default 20)")
    parser.add_argument("--max-words", type=int, default=80, help="largo máximo del texto original (default 80)")
    parser.add_argument("--keep", action="store_true", help="no borrar el pod al terminar")
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    settings = get_settings()
    runpod.api_key = settings.runpod_api_key  # el SDK de RunPod no lee RUNPOD_API_KEY solo

    if args.unlabeled:
        reviews = pick_unlabeled(args.n, args.seed, args.min_words, args.max_words)
    else:
        langs = LANGS if args.lang == "all" else [args.lang]
        reviews = pick_reviews(args.split, args.n, args.seed, langs, args.min_words, args.max_words)
    aspects = load_aspects()
    questions = {d: Choice(instructions=aspects[d], criteria=CRITERIA) for d in DIMS}

    pod = provision_pod()
    log.info("pod %s -> %s", pod["id"], pod["base_url"])
    try:
        wait_until_healthy(pod["health_url"])
        client = TypeSafeClient(
            api_key=settings.kev_api_key,
            base_url=pod["base_url"],
            model="kev-latest",
            compression=False,  # kev.serve no sabe leer bodies comprimidos con zstd
            timeout=120,
        )
        for i, r in enumerate(reviews, 1):
            r["kev"] = rate(client, questions, r["text_en"])
            got = " ".join(f"{d}={r['kev'][d]['choice']}/{r['human'][d]}" for d in DIMS)
            log.info("%d/%d %s  (kev/humano) %s", i, len(reviews), r["id"], got)
    finally:
        # se guarda lo que se haya puntuado aunque haya fallado a la mitad
        rated = [r for r in reviews if "kev" in r]
        if rated:
            DATA_DIR.mkdir(exist_ok=True)
            source = "resenas_ingles.csv (sin etiquetar)" if args.unlabeled else args.split
            out = {"source": source, "seed": args.seed, "reviews": rated}
            KEV_RATINGS_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
            log.info("%d reseñas guardadas en %s", len(rated), KEV_RATINGS_PATH.relative_to(ROOT))
        if args.keep:
            log.info("dejo el pod %s prendido (--keep): bajarlo con deploy_models.py down", pod["id"])
        else:
            terminate_kev_pods()


if __name__ == "__main__":
    main()
