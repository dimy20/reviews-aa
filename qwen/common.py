"""Lo que comparten qwen/run.py y qwen/sample_kev.py.

La lógica de Qwen (prompt, schema, chequeo de citas) vive en engine/explain.py, que es lo que
usa la API: estos scripts la reusan para probar prompts sin levantar la API.
"""
from pathlib import Path

from engine.explain import DIMS, PROMPT_PATH, explain_kev_ratings  # noqa: F401

# ---------------------------------------------------------------------------
# Rutas
# ---------------------------------------------------------------------------
QWEN_DIR = Path(__file__).resolve().parent
PROMPTS_DIR = QWEN_DIR / "prompts"                    # variantes del prompt para comparar, una por .txt
DATA_DIR = QWEN_DIR / "data"
RESULTS_DIR = QWEN_DIR / "results"                    # acá queda lo que respondió Qwen
KEV_RATINGS_PATH = DATA_DIR / "kev_ratings.json"      # lo que devolvió kev (qwen/sample_kev.py)


def load_prompts() -> dict[str, str]:
    """El prompt que usa la API ("explain", engine/prompts/explain.txt) más las variantes de
    qwen/prompts/. Para probar un prompt nuevo, alcanza con crear otro .txt en esa carpeta."""
    prompts = {"explain": PROMPT_PATH.read_text(encoding="utf-8")}
    prompts.update({p.stem: p.read_text(encoding="utf-8") for p in sorted(PROMPTS_DIR.glob("*.txt"))})
    return prompts


async def explain(template: str, review: str, kev: dict, temperature: float = 0.3) -> dict:
    """Como explain_kev_ratings, pero con kev en el formato de kev_ratings.json:
    {"food": {"choice": "4", "confidence": ...}, ...}. De kev se usa solo "choice"."""
    ratings = {d: kev[d]["choice"] for d in DIMS}
    return await explain_kev_ratings(review, ratings, template=template, temperature=temperature)
