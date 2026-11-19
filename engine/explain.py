"""Qwen explica los puntajes de kev: una cita de la reseña y una oración en español por aspecto.

    engine/prompts/explain.txt  (con los huecos {review} y {ratings})
            │
            ▼  render()   la reseña ORIGINAL (en, es o pt) y los puntajes que kev le puso a la traducción
    el prompt completo
            │
            ▼  _chat()    Qwen por OpenRouter, que responde un JSON con SCHEMA
    {"food": {"quote", "explanation"} | null, ...}
            │
            ▼  build()    le suma el puntaje de kev a cada aspecto y revisa la cita
    {"food": {"score": 4, "quote": "...", "explanation": "..."}, "wait_time": None, ...}

explain_kev_ratings() hace los tres pasos. Para probar variantes del prompt: qwen/run.py.
"""
import json
import re
from pathlib import Path

from engine.openrouter import openrouter

DIMS = ["food", "wait_time", "service", "price", "experience"]

PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "explain.txt"
MODEL = "qwen/qwen3.5-9b"  # Qwen 3.5 de 9B parámetros, servido por OpenRouter

# Lo que tiene que devolver Qwen. Con "strict" el proveedor no lo deja salirse del formato:
# nada de texto antes o después, siempre las cinco claves, cada una un objeto o null.
_ASPECT = {
    "anyOf": [
        {
            "type": "object",
            "properties": {
                "quote": {"type": ["string", "null"]},
                "explanation": {"type": "string"},
            },
            "required": ["quote", "explanation"],
            "additionalProperties": False,
        },
        {"type": "null"},
    ]
}
SCHEMA = {
    "type": "object",
    "properties": {dim: _ASPECT for dim in DIMS},
    "required": DIMS,
    "additionalProperties": False,
}

# Tope de la respuesta. Por aspecto: cita (<= 25 palabras, ~35 tokens) + explicación
# (<= 20 palabras en español, ~35 tokens) + las llaves del JSON (~15) = ~85. Por 5 aspectos ~425.
MAX_TOKENS = 500


def load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _is_na(value) -> bool:
    return value is None or str(value) in ("N/A", "-1")


def format_ratings(ratings: dict) -> str:
    """Los puntajes como texto para el prompt:

        - food: 4
        - wait_time: N/A
    """
    return "\n".join(f"- {d}: {'N/A' if _is_na(ratings[d]) else ratings[d]}" for d in DIMS)


def render(template: str, review: str, ratings: dict) -> str:
    """Reemplaza {review} (el texto ORIGINAL, para que la cita salga en ese idioma) y {ratings}."""
    # replace y no format(): así el prompt puede tener otras llaves, como un ejemplo de JSON
    return template.replace("{review}", review).replace("{ratings}", format_ratings(ratings))


async def _chat(prompt: str, temperature: float) -> str:
    res = await openrouter().chat.send_async(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,  # bajo: tiene que copiar citas al pie de la letra
        max_tokens=MAX_TOKENS,
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "explanations", "strict": True, "schema": SCHEMA},
        },
        # Que no "piense" antes de responder. Con {"enabled": False} algunos proveedores lo
        # ignoraban, gastaban todos los tokens pensando y la respuesta volvía vacía.
        reasoning={"effort": "none"},
        provider={
            "quantizations": ["bf16"],   # el modelo sin comprimir: los que lo comprimen responden peor
            "require_parameters": True,  # solo proveedores que respetan response_format
        },
    )
    choice = res.choices[0]
    if choice.message.content is None:
        raise RuntimeError(f"Qwen respondió vacío (finish_reason={choice.finish_reason})")
    if choice.finish_reason == "length":
        raise RuntimeError(f"Qwen se pasó de {MAX_TOKENS} tokens y la respuesta quedó cortada")
    return choice.message.content.strip()


def _norm(s: str) -> str:
    """Para comparar la cita con la reseña sin que molesten espacios, mayúsculas ni comillas curvas."""
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", s).strip().lower()


def _literal_quote(quote: str | None, review: str) -> str | None:
    """La cita si está tal cual en la reseña. Si Qwen pegó partes con "..." (pasa aunque el
    prompt lo prohíbe), se queda con la parte literal más larga. Si no hay ninguna, None."""
    if not quote:
        return None
    text = _norm(review)
    parts = [p.strip() for p in re.split(r"\.\.\.|…", quote)]
    parts = [p for p in parts if len(p.split()) >= 2 and _norm(p) in text]
    return max(parts, key=len) if parts else None


def build(review: str, ratings: dict, answer: str) -> dict:
    """Junta la respuesta de Qwen con los puntajes de kev:

        {"food": {"score": 4, "quote": "...", "explanation": "..."}, "wait_time": None, ...}

    - El puntaje sale siempre de kev, nunca de Qwen.
    - Si kev dijo N/A, el aspecto es None aunque Qwen haya escrito algo.
    - Si la cita no aparece tal cual en la reseña (Qwen la inventó o la tradujo), queda en None.
    """
    data = json.loads(answer)
    out = {}
    for dim in DIMS:
        if _is_na(ratings[dim]):
            out[dim] = None
            continue
        item = data.get(dim) or {}
        out[dim] = {
            "score": int(ratings[dim]),
            "quote": _literal_quote(item.get("quote"), review),
            "explanation": item.get("explanation"),
        }
    return out


async def explain_kev_ratings(review: str, ratings: dict, template: str | None = None,
                              temperature: float = 0.3) -> dict:
    """review: el texto original. ratings: {dim: 1-5 | "1"-"5" | "N/A"}, lo que devolvió kev.
    template: otro prompt para probar (qwen/run.py); por defecto engine/prompts/explain.txt."""
    prompt = render(template or load_prompt(), review, ratings)
    return build(review, ratings, await _chat(prompt, temperature))
