"""Base de la API: la tabla reviews y las consultas que usan las rutas.

sqlite3 bloquea, así que las funciones async corren cada consulta en un hilo aparte
(asyncio.to_thread): mientras una reseña espera a la base, el servidor sigue atendiendo a las demás.
"""
import asyncio
import json
import sqlite3

from engine.explain import DIMS  # noqa: F401 (las rutas la usan como db.DIMS)
from settings import get_settings

SCHEMA = """--sql
CREATE TABLE IF NOT EXISTS reviews (
    id           INTEGER PRIMARY KEY,
    name         TEXT,                                   -- opcional, lo escribe el cliente
    text         TEXT NOT NULL,                          -- la reseña tal cual llegó: es lo que lee Qwen
    lang         TEXT CHECK (lang IN ('en', 'es', 'pt')),
    text_en      TEXT,                                   -- la traducción al inglés: es lo que lee kev
    -- puntajes de kev: 1-5, -1 = N/A, NULL = todavía sin puntuar
    food         INTEGER CHECK (food IN (-1, 1, 2, 3, 4, 5)),
    wait_time    INTEGER CHECK (wait_time IN (-1, 1, 2, 3, 4, 5)),
    service      INTEGER CHECK (service IN (-1, 1, 2, 3, 4, 5)),
    price        INTEGER CHECK (price IN (-1, 1, 2, 3, 4, 5)),
    experience   INTEGER CHECK (experience IN (-1, 1, 2, 3, 4, 5)),
    -- lo que escribe Qwen, en JSON: {"food": {"quote": ..., "explanation": ...} | null, ...}
    explanations TEXT,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error')),
    error        TEXT,                                   -- por qué falló, si status = 'error'
    created_at   TEXT NOT NULL DEFAULT (datetime('now')), -- UTC
    analyzed_at  TEXT                                     -- UTC
);
"""


def get_connection() -> sqlite3.Connection:
    # timeout: si otra reseña está escribiendo, espera hasta 10 s en vez de fallar
    conn = sqlite3.connect(get_settings().reviews_db_path, timeout=10)
    conn.row_factory = sqlite3.Row  # las filas se leen como dicts
    return conn


def init_db() -> None:
    with get_connection() as conn:
        # WAL: leer (GET /reviews) no espera a que termine una escritura
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        columns = {row["name"] for row in conn.execute("""--sql
            SELECT name FROM pragma_table_info('reviews')
        """)}
    # CREATE TABLE IF NOT EXISTS no modifica una tabla vieja: mejor fallar claro que a la mitad
    if "status" not in columns:
        raise RuntimeError(
            "La tabla reviews tiene el esquema viejo. Borrá la base (api/reviews.db, o en Docker "
            "docker compose -f compose.app.yaml down -v) y volvé a arrancar la API."
        )


# ---------------------------------------------------------------------------
# Consultas (sincrónicas: se llaman con asyncio.to_thread desde las funciones async de abajo)
# ---------------------------------------------------------------------------
def _list_reviews() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("""--sql
            SELECT * FROM reviews ORDER BY id DESC
        """).fetchall()
    return [dict(row) for row in rows]


def _get_review(review_id: int) -> dict | None:
    with get_connection() as conn:
        row = conn.execute("""--sql
            SELECT * FROM reviews WHERE id = ?
        """, (review_id,)).fetchone()
    return dict(row) if row else None


def _insert_review(text: str, name: str | None) -> int:
    with get_connection() as conn:
        cur = conn.execute("""--sql
            INSERT INTO reviews (text, name) VALUES (?, ?)
        """, (text, name))
        return cur.lastrowid


def _save_translation(review_id: int, lang: str, text_en: str) -> None:
    with get_connection() as conn:
        conn.execute("""--sql
            UPDATE reviews SET lang = ?, text_en = ? WHERE id = ?
        """, (lang, text_en, review_id))


def _save_scores(review_id: int, scores: list[int]) -> None:
    with get_connection() as conn:
        conn.execute("""--sql
            UPDATE reviews SET food = ?, wait_time = ?, service = ?, price = ?, experience = ?
            WHERE id = ?
        """, (*scores, review_id))


def _save_explanations(review_id: int, explanations: str) -> None:
    with get_connection() as conn:
        conn.execute("""--sql
            UPDATE reviews
            SET explanations = ?, status = 'done', error = NULL, analyzed_at = datetime('now')
            WHERE id = ?
        """, (explanations, review_id))


def _mark_error(review_id: int, error: str) -> None:
    with get_connection() as conn:
        conn.execute("""--sql
            UPDATE reviews SET status = 'error', error = ? WHERE id = ?
        """, (error, review_id))


# ---------------------------------------------------------------------------
# Lo que usan las rutas
# ---------------------------------------------------------------------------
async def list_reviews() -> list[dict]:
    """Todas las reseñas, la más nueva primero."""
    return await asyncio.to_thread(_list_reviews)


async def get_review(review_id: int) -> dict | None:
    return await asyncio.to_thread(_get_review, review_id)


async def insert_review(text: str, name: str | None) -> int:
    """Guarda una reseña recién llegada (status 'pending') y devuelve su id."""
    return await asyncio.to_thread(_insert_review, text, name)


async def save_translation(review_id: int, lang: str, text_en: str) -> None:
    """El idioma detectado y el texto que lee kev (si la reseña ya era en inglés, el mismo)."""
    await asyncio.to_thread(_save_translation, review_id, lang, text_en)


async def save_scores(review_id: int, ratings: dict) -> None:
    """Los puntajes de kev. kev usa "N/A" y strings ("4"); la base, -1 y enteros."""
    scores = [-1 if str(ratings[d]) == "N/A" else int(ratings[d]) for d in DIMS]
    await asyncio.to_thread(_save_scores, review_id, scores)


async def save_explanations(review_id: int, explained: dict) -> None:
    """Lo de Qwen (engine/explain.py) y marca la reseña como terminada. El puntaje ya está
    en sus columnas, así que del JSON se guardan solo la cita y la explicación."""
    data = {
        d: None if explained[d] is None
        else {"quote": explained[d]["quote"], "explanation": explained[d]["explanation"]}
        for d in DIMS
    }
    await asyncio.to_thread(_save_explanations, review_id, json.dumps(data, ensure_ascii=False))


async def mark_error(review_id: int, error: str) -> None:
    await asyncio.to_thread(_mark_error, review_id, error)
