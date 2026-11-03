"""LLM suggestion for one review (LangChain + OpenRouter, structured output).

Called by the labeling server when someone presses "Sugerir". The prompt is the
few-shot file at the repo root: instructions + examples go in the system message,
the review fills `{{RESEÑA}}` in the user message.

Needs OPENROUTER_API_KEY. The model defaults to openai/gpt-4o-mini and can be
changed with `app.py serve --model ...` (or the SUGGEST_MODEL env var).
"""

from __future__ import annotations

import hashlib
import os
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Literal

from langchain_core.prompts import ChatPromptTemplate
from langchain_openrouter import ChatOpenRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator

PROMPT_PATH = Path(__file__).resolve().parents[2] / "few_shot_etiquetado_resenas.md"
# Same setup as the AutoServy bot, which works: a fast model with no reasoning step,
# structured output via function calling, temperature 0.
DEFAULT_MODEL = os.environ.get("SUGGEST_MODEL", "openai/gpt-4o-mini")
TIMEOUT_MS = 45_000  # per attempt; the UI shows the error after this
PROMPT_SPLIT = "## Nueva reseña a clasificar"  # system part above, the review to label below

# Prompt keys -> labels.db columns
DIM_MAP = {
    "satisfaccion_comida": "food",
    "tiempo_espera": "wait_time",
    "atencion": "service",
    "precio": "price",
    "experiencia": "experience",
}


class Dimension(BaseModel):
    # Strict structured output requires "additionalProperties": false on every object;
    # without it OpenRouter / the provider rejects the request with 400 Bad Request.
    model_config = ConfigDict(extra="forbid")

    # String enum so every provider's strict JSON-schema mode accepts it
    # (mixed int/string enums are not supported everywhere).
    puntuacion: Literal["1", "2", "3", "4", "5", "N/A"] = Field(
        description='Puntaje entero del 1 al 5, o "N/A" si la reseña no da evidencia suficiente.'
    )
    justificacion: str = Field(description="Justificación breve en español, basada solo en la reseña.")

    @field_validator("puntuacion", mode="before")
    @classmethod
    def _int_to_str(cls, v):
        return str(v) if isinstance(v, int) else v


class Evaluacion(BaseModel):
    """Calificación de una reseña en las cinco dimensiones."""

    model_config = ConfigDict(extra="forbid")

    satisfaccion_comida: Dimension
    tiempo_espera: Dimension
    atencion: Dimension
    precio: Dimension
    experiencia: Dimension


def build_prompt(path: Path = PROMPT_PATH) -> tuple[ChatPromptTemplate, str]:
    text = path.read_text(encoding="utf-8")
    system, sep, human = text.partition(PROMPT_SPLIT)
    if not sep or "{{RESEÑA}}" not in human:
        raise ValueError(f"{path.name} must contain '{PROMPT_SPLIT}' followed by '{{{{RESEÑA}}}}'")
    prompt = ChatPromptTemplate.from_messages(
        [("system", system.strip()), ("human", (sep + human).strip())],
        template_format="mustache",
    )
    return prompt, hashlib.sha256(text.encode()).hexdigest()[:12]


@lru_cache(maxsize=4)
def _chain(model: str, prompt_hash: str):
    # prompt_hash is part of the cache key so editing the prompt file takes effect
    # without restarting the server.
    prompt, _ = build_prompt()
    # Interactive button: fail fast and show the real error. We build the SDK client
    # ourselves because ChatOpenRouter(max_retries=0) passes no retry config, and the
    # openrouter SDK then falls back to retrying 5xx errors for up to an HOUR, which
    # looks like a stuck button.
    import openrouter
    from openrouter.utils import BackoffStrategy, RetryConfig

    client = openrouter.OpenRouter(
        api_key=os.environ["OPENROUTER_API_KEY"],
        timeout_ms=TIMEOUT_MS,
        retry_config=RetryConfig("none", BackoffStrategy(500, 1000, 1.5, 0), False),
    )
    llm = ChatOpenRouter(model=model, client=client, max_retries=0, temperature=0)
    # include_raw: keep the raw reply so a bad answer can be logged and retried
    # instead of surfacing as an opaque parser traceback.
    return prompt | llm.with_structured_output(Evaluacion, include_raw=True)


class BadAnswer(Exception):
    """The model replied, but not with a valid Evaluacion."""


def _ask(chain, text: str, model: str) -> Evaluacion:
    t0 = time.monotonic()
    out = chain.invoke({"RESEÑA": text})
    raw, meta = out["raw"], out["raw"].response_metadata
    info = (
        f"{model} via {meta.get('provider', '?')}, {time.monotonic() - t0:.1f}s, "
        f"finish_reason={meta.get('finish_reason')}, "
        f"tokens={getattr(raw, 'usage_metadata', None) or '?'}"
    )
    if out["parsed"] is None:
        # With function calling the answer is in the tool call, not in the text.
        content = str(raw.additional_kwargs.get("tool_calls") or raw.tool_calls or raw.content)
        print(f"[Sugerir] bad answer ({info}): {content[:500]!r}", file=sys.stderr)
        raise BadAnswer(f"respuesta inválida del modelo ({info}): {out['parsing_error']}")
    print(f"[Sugerir] ok ({info})", file=sys.stderr)
    return out["parsed"]


def suggest(text: str, model: str = DEFAULT_MODEL) -> dict:
    """Returns {"scores": {dim: 1-5 | None}, "justifications": {dim: str}, "prompt_hash": str}."""
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise RuntimeError("OPENROUTER_API_KEY no está configurada en el servidor.")
    _, prompt_hash = build_prompt()
    chain = _chain(model, prompt_hash)
    try:
        ev = _ask(chain, text, model)
    except BadAnswer:
        ev = _ask(chain, text, model)  # one retry: a malformed answer is usually a fluke
    data = ev.model_dump()
    return {
        "scores": {DIM_MAP[k]: None if v["puntuacion"] == "N/A" else int(v["puntuacion"]) for k, v in data.items()},
        "justifications": {DIM_MAP[k]: v["justificacion"] for k, v in data.items()},
        "prompt_hash": prompt_hash,
    }
