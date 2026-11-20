"""Borra todas las reseñas de la base de la API, para empezar de cero.

Solo vacía la tabla reviews: la tabla y su esquema quedan como están.

    uv run python -m api.clean          # pregunta antes de borrar
    uv run python -m api.clean --yes    # sin preguntar

En Docker la base vive en el volumen, así que se corre dentro del contenedor:

    docker compose -f compose.app.yaml exec api python -m api.clean
"""
import argparse

from api.db import get_connection
from settings import get_settings


def count_reviews() -> int:
    with get_connection() as conn:
        return conn.execute("""--sql
            SELECT COUNT(*) FROM reviews
        """).fetchone()[0]


def delete_reviews() -> None:
    with get_connection() as conn:
        conn.execute("""--sql
            DELETE FROM reviews
        """)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Borra todas las reseñas de la base de la API.")
    parser.add_argument("--yes", action="store_true", help="no preguntar antes de borrar")
    args = parser.parse_args()

    total = count_reviews()
    print(f"{get_settings().reviews_db_path}: {total} reseñas")

    if total == 0:
        raise SystemExit("No hay nada que borrar.")

    if not args.yes and input(f"¿Borrar las {total} reseñas? [s/N] ").strip().lower() != "s":
        raise SystemExit("Cancelado, no se borró nada.")

    delete_reviews()
    print(f"ok: {total} reseñas borradas, quedan {count_reviews()}")
