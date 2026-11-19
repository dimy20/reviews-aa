"""Un solo cliente de OpenRouter para todo el proceso (traducción y Qwen).

Crear uno por request abre conexiones nuevas cada vez; reusarlo deja que las 17 reseñas que
llegan juntas compartan las conexiones.
"""
from functools import lru_cache

from openrouter import OpenRouter

from settings import get_settings


@lru_cache
def openrouter() -> OpenRouter:
    return OpenRouter(api_key=get_settings().openrouter_api_key)  # la clave sale del .env
