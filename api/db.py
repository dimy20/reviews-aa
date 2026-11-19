import sqlite3

from settings import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY,
    user       TEXT NOT NULL,
    text       TEXT NOT NULL,
    -- 1-5, -1 = N/A, NULL = not analyzed yet
    food       INTEGER CHECK (food IN (-1, 1, 2, 3, 4, 5)),
    wait_time  INTEGER CHECK (wait_time IN (-1, 1, 2, 3, 4, 5)),
    service    INTEGER CHECK (service IN (-1, 1, 2, 3, 4, 5)),
    price      INTEGER CHECK (price IN (-1, 1, 2, 3, 4, 5)),
    experience INTEGER CHECK (experience IN (-1, 1, 2, 3, 4, 5)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""
# The pods table is created by migrations/create_pods_table.py.


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_settings().reviews_db_path)
    conn.row_factory = sqlite3.Row  # rows behave like dicts
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(SCHEMA)
