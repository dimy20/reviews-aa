"""Detección de idioma con fastText (lid.176), el más rápido y preciso en
notebooks/02_deteccion_idioma/02_comparar_fasttext_langdetect.ipynb.
"""
from functools import lru_cache
from typing import Literal

import fasttext

from settings import get_settings

Lang = Literal["en", "es", "pt"]
SUPPORTED: tuple[Lang, ...] = ("en", "es", "pt")


@lru_cache
def load_model():
    """Carga el modelo una sola vez (~1 MB). La API lo llama al arrancar para no hacerlo en un request."""
    return fasttext.load_model(str(get_settings().lid_model_path))


def detect_lang(text: str) -> Lang:
    """El idioma de la reseña, entre en, es y pt.

    fastText reconoce 176 idiomas: de su ranking nos quedamos con el primero de los tres que
    soportamos. Así una reseña en español que se parece al gallego o al catalán sigue siendo "es".
    Tarda menos de un milisegundo, así que no hace falta correrlo en otro hilo.
    """
    line = text.replace("\n", " ") + "\n"  # fastText necesita un solo salto de línea, al final
    # k=-1: todos los idiomas, ordenados de más a menos probable.
    # model.f.predict y no model.predict: con numpy 2 el segundo falla.
    for _, label in load_model().f.predict(line, -1, 0.0, "strict"):
        lang = label.removeprefix("__label__")
        if lang in SUPPORTED:
            return lang
    return "en"
