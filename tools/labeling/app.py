#!/usr/bin/env python3
"""Aspect labeling tool for the restaurant review subset.

Stdlib only: an HTTP server, a single-page UI (index.html) and SQLite.

    uv run tools/labeling/app.py serve                 # http://127.0.0.1:8765
    uv run tools/labeling/app.py serve --host 0.0.0.0  # share with the team on the LAN
    uv run tools/labeling/app.py stats
    uv run tools/labeling/app.py export labels.jsonl   # or .csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sqlite3
import sys
import time
import traceback
from contextlib import closing
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
REVIEWS_DIR = ROOT / "reseñas"
DEFAULT_DB = HERE / "labels.db"
DEFAULT_SUBSET = REVIEWS_DIR / "training_subset.csv"

# Source files the subset was sampled from. Used to attach the Yelp star rating
# and the English original of each translated review (shown as a hint in the UI).
SOURCES = [
    ("resenas_ingles.csv", "Review Text", "en"),
    ("resenas_espanol_trad.csv", "Review Text_es", "es"),
    ("resenas_portugues_trad.csv", "Review Text_pt-BR", "pt"),
]

# Column name -> label shown in the UI. Scores are 1-5; NULL means N/A.
DIMENSIONS = {
    "food": "Satisfacción comida",
    "wait_time": "Tiempo de espera",
    "service": "Atención",
    "price": "Precio",
    "experience": "Experiencia",
}
DIMS = list(DIMENSIONS)
LANGS = ("en", "es", "pt")

DEFAULT_SUGGEST_MODEL = os.environ.get("SUGGEST_MODEL", "openai/gpt-4o-mini")
CLAIM_TTL_S = 15 * 60  # a review served to one annotator is hidden from others for this long
SHUFFLE_SEED = 42

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS reviews (
    id        INTEGER PRIMARY KEY,
    text      TEXT NOT NULL,
    lang      TEXT NOT NULL CHECK (lang IN ('en', 'es', 'pt')),
    position  INTEGER NOT NULL UNIQUE,   -- shuffled labeling order, keeps languages mixed
    rating    INTEGER,                   -- Yelp stars, from the source CSV
    source_en TEXT,                      -- English original (es/pt rows are translations)
    UNIQUE (text, lang)
);

CREATE TABLE IF NOT EXISTS labels (
    review_id  INTEGER PRIMARY KEY REFERENCES reviews(id),
    annotator  TEXT NOT NULL,
    {", ".join(f"{d} INTEGER CHECK ({d} BETWEEN 1 AND 5)" for d in DIMS)},  -- NULL = N/A
    flagged    INTEGER NOT NULL DEFAULT 0,   -- unclear / bad translation / needs discussion
    note       TEXT,
    seconds    REAL,                         -- time spent on this review in the UI
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every save, including edits, for auditing and agreement checks.
CREATE TABLE IF NOT EXISTS label_history (
    id         INTEGER PRIMARY KEY,
    review_id  INTEGER NOT NULL REFERENCES reviews(id),
    annotator  TEXT NOT NULL,
    {", ".join(f"{d} INTEGER" for d in DIMS)},
    flagged    INTEGER NOT NULL,
    note       TEXT,
    seconds    REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skips (
    review_id  INTEGER NOT NULL REFERENCES reviews(id),
    annotator  TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (review_id, annotator)
);

-- LLM "first try" labels from the Sugerir button (suggest.py), one per review; "regenerar" replaces it.
-- Kept apart from `labels` so human labels can be compared against them.
CREATE TABLE IF NOT EXISTS suggestions (
    review_id      INTEGER PRIMARY KEY REFERENCES reviews(id),
    model          TEXT NOT NULL,
    prompt_hash    TEXT NOT NULL,                -- which version of the prompt produced it
    {", ".join(f"{d} INTEGER CHECK ({d} BETWEEN 1 AND 5)" for d in DIMS)},  -- NULL = N/A
    justifications TEXT NOT NULL,                -- JSON {{dimension: text}}
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lease so two annotators working at the same time never get the same review.
CREATE TABLE IF NOT EXISTS claims (
    review_id  INTEGER PRIMARY KEY REFERENCES reviews(id),
    annotator  TEXT NOT NULL,
    claimed_at REAL NOT NULL
);
"""


# --------------------------------------------------------------------------- db


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path: Path) -> None:
    with closing(connect(db_path)) as conn:
        conn.executescript(SCHEMA)


def load_source_index() -> dict[tuple[str, str], tuple[int | None, str]]:
    index: dict[tuple[str, str], tuple[int | None, str]] = {}
    for fname, col, lang in SOURCES:
        path = REVIEWS_DIR / fname
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                rating = int(row["Rating"]) if row.get("Rating", "").strip().isdigit() else None
                index[(row[col].strip(), lang)] = (rating, row["Review Text"].strip())
    return index


def import_subset(db_path: Path, csv_path: Path) -> dict:
    """Idempotent: re-running only adds rows that are not in the DB yet."""
    init_db(db_path)
    with csv_path.open(newline="", encoding="utf-8") as f:
        rows = [(r["text"].strip(), r["lang"].strip()) for r in csv.DictReader(f)]

    unique = list(dict.fromkeys(r for r in rows if r[0]))
    random.Random(SHUFFLE_SEED).shuffle(unique)
    sources = load_source_index()

    with closing(connect(db_path)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        start = conn.execute("SELECT COALESCE(MAX(position), 0) FROM reviews").fetchone()[0]
        added = 0
        for text, lang in unique:
            rating, source_en = sources.get((text, lang), (None, None))
            cur = conn.execute(
                "INSERT OR IGNORE INTO reviews (text, lang, position, rating, source_en) "
                "VALUES (?, ?, ?, ?, ?)",
                (text, lang, start + added + 1, rating, source_en if lang != "en" else None),
            )
            added += cur.rowcount
        conn.execute("COMMIT")
        total = conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
    return {"rows": len(rows), "duplicates": len(rows) - len(unique), "added": added, "total": total}


def review_payload(conn: sqlite3.Connection, review_id: int) -> dict | None:
    r = conn.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone()
    if r is None:
        return None
    label = conn.execute("SELECT * FROM labels WHERE review_id = ?", (review_id,)).fetchone()
    sug = conn.execute("SELECT * FROM suggestions WHERE review_id = ?", (review_id,)).fetchone()
    return {
        "id": r["id"],
        "text": r["text"],
        "lang": r["lang"],
        "position": r["position"],
        "rating": r["rating"],
        "source_en": r["source_en"],
        "label": None
        if label is None
        else {
            "annotator": label["annotator"],
            "scores": {d: label[d] for d in DIMS},
            "flagged": bool(label["flagged"]),
            "note": label["note"] or "",
            "updated_at": label["updated_at"],
        },
        "suggestion": None
        if sug is None
        else {
            "model": sug["model"],
            "scores": {d: sug[d] for d in DIMS},
            "justifications": json.loads(sug["justifications"]),
        },
    }


def clean_lang(lang) -> str | None:
    """'' / None / 'all' mean every language."""
    lang = (lang or "").strip().lower()
    if lang in ("", "all"):
        return None
    if lang not in LANGS:
        raise ValueError(f"lang must be one of {', '.join(LANGS)} or 'all'")
    return lang


def claim(conn: sqlite3.Connection, review_id: int, annotator: str, now: float) -> None:
    """An annotator holds at most one review at a time."""
    conn.execute("DELETE FROM claims WHERE annotator = ?", (annotator,))
    conn.execute(
        "INSERT OR REPLACE INTO claims (review_id, annotator, claimed_at) VALUES (?, ?, ?)",
        (review_id, annotator, now),
    )


def next_review(conn: sqlite3.Connection, annotator: str, lang: str | None = None) -> dict:
    now = time.time()
    # `? IS NULL OR r.lang = ?` lets one query serve both "all languages" and a single one.
    lang_args = (lang, lang)
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM claims WHERE claimed_at < ?", (now - CLAIM_TTL_S,))
        # Resume the review this annotator already holds (e.g. after a page reload),
        # as long as it is still unlabeled and in the selected language.
        row = conn.execute(
            """SELECT c.review_id,
                      EXISTS (SELECT 1 FROM skips s WHERE s.review_id = c.review_id) AS was_skipped
               FROM claims c JOIN reviews r ON r.id = c.review_id
               WHERE c.annotator = ? AND (? IS NULL OR r.lang = ?)
                 AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.review_id = c.review_id)
               ORDER BY c.claimed_at DESC LIMIT 1""",
            (annotator, *lang_args),
        ).fetchone()
        if row is None:
            # Fresh reviews first: not labeled, not held by anyone, not skipped by anyone.
            # Skipped ones are reached through the skipped list (or below, once the queue is empty).
            row = conn.execute(
                """SELECT r.id AS review_id, 0 AS was_skipped FROM reviews r
                   WHERE (? IS NULL OR r.lang = ?)
                     AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.review_id = r.id)
                     AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.review_id = r.id)
                     AND NOT EXISTS (SELECT 1 FROM skips s WHERE s.review_id = r.id)
                   ORDER BY r.position LIMIT 1""",
                lang_args,
            ).fetchone()
        if row is None:
            # Only skipped reviews are left: serve them so none is missed, the ones this
            # annotator did not skip first, then the oldest skips.
            row = conn.execute(
                """SELECT r.id AS review_id, 1 AS was_skipped FROM reviews r
                   WHERE (? IS NULL OR r.lang = ?)
                     AND EXISTS (SELECT 1 FROM skips s WHERE s.review_id = r.id)
                     AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.review_id = r.id)
                     AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.review_id = r.id)
                   ORDER BY EXISTS (SELECT 1 FROM skips s
                                    WHERE s.review_id = r.id AND s.annotator = ?),
                            (SELECT MAX(s.created_at) FROM skips s WHERE s.review_id = r.id),
                            r.position
                   LIMIT 1""",
                (*lang_args, annotator),
            ).fetchone()
        if row is None:
            conn.execute("COMMIT")
            return {"done": True}
        claim(conn, row["review_id"], annotator, now)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    payload = review_payload(conn, row["review_id"])
    payload["was_skipped"] = bool(row["was_skipped"])
    return payload


def open_review(conn: sqlite3.Connection, review_id: int, annotator: str | None) -> dict:
    """Fetch one review. With an annotator, an unlabeled review is also claimed for them
    (used when picking a review from the skipped list); `held_by` warns if someone else has it."""
    now = time.time()
    held_by = None
    if annotator:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute("DELETE FROM claims WHERE claimed_at < ?", (now - CLAIM_TTL_S,))
            unlabeled = conn.execute(
                "SELECT 1 FROM reviews r WHERE r.id = ? "
                "AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.review_id = r.id)",
                (review_id,),
            ).fetchone()
            if unlabeled:
                other = conn.execute(
                    "SELECT annotator FROM claims WHERE review_id = ? AND annotator != ?",
                    (review_id, annotator),
                ).fetchone()
                if other:
                    held_by = other["annotator"]
                else:
                    claim(conn, review_id, annotator, now)
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    payload = review_payload(conn, review_id)
    if payload is None:
        raise LookupError("review not found")
    payload["held_by"] = held_by
    payload["skips"] = skips_for(conn, review_id)
    payload["was_skipped"] = bool(payload["skips"]) and payload["label"] is None
    return payload


def skips_for(conn: sqlite3.Connection, review_id: int) -> list[dict]:
    return [
        dict(r)
        for r in conn.execute(
            "SELECT annotator, created_at FROM skips WHERE review_id = ? ORDER BY created_at",
            (review_id,),
        )
    ]


def skipped_list(conn: sqlite3.Connection, lang: str | None) -> list[dict]:
    """Every skipped review that still has no label, from all annotators."""
    rows = conn.execute(
        """SELECT r.id AS review_id, r.lang, substr(r.text, 1, 90) AS snippet,
                  group_concat(s.annotator, ', ') AS skipped_by,
                  MAX(s.created_at) AS last_skipped,
                  (SELECT c.annotator FROM claims c
                   WHERE c.review_id = r.id AND c.claimed_at > ?) AS held_by
           FROM skips s JOIN reviews r ON r.id = s.review_id
           WHERE (? IS NULL OR r.lang = ?)
             AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.review_id = r.id)
           GROUP BY r.id ORDER BY MAX(s.created_at)""",
        (time.time() - CLAIM_TTL_S, lang, lang),
    ).fetchall()
    return [dict(r) for r in rows]


def save_label(conn: sqlite3.Connection, body: dict) -> dict:
    review_id = int(body["review_id"])
    annotator = clean_annotator(body.get("annotator"))
    scores = body.get("scores") or {}
    # Every dimension must be sent explicitly: 1-5, or null for N/A. A missing key means
    # the annotator never looked at that dimension, so it is rejected, not stored as N/A.
    missing = [d for d in DIMS if d not in scores]
    if missing:
        raise ValueError(f"missing dimensions: {', '.join(missing)} (use null for N/A)")
    values = []
    for d in DIMS:
        v = scores[d]
        if v is not None:
            v = int(v)
            if not 1 <= v <= 5:
                raise ValueError(f"{d}: score must be 1-5 or null (N/A)")
        values.append(v)
    flagged = 1 if body.get("flagged") else 0
    note = (body.get("note") or "").strip() or None
    seconds = body.get("seconds")
    seconds = round(float(seconds), 1) if seconds is not None else None

    conn.execute("BEGIN IMMEDIATE")
    try:
        if conn.execute("SELECT 1 FROM reviews WHERE id = ?", (review_id,)).fetchone() is None:
            raise ValueError(f"unknown review {review_id}")
        cols = ", ".join(DIMS)
        marks = ", ".join("?" for _ in DIMS)
        updates = ", ".join(f"{d} = excluded.{d}" for d in DIMS)
        conn.execute(
            f"""INSERT INTO labels (review_id, annotator, {cols}, flagged, note, seconds)
                VALUES (?, ?, {marks}, ?, ?, ?)
                ON CONFLICT (review_id) DO UPDATE SET
                    annotator = excluded.annotator, {updates},
                    flagged = excluded.flagged, note = excluded.note,
                    seconds = COALESCE(labels.seconds, 0) + COALESCE(excluded.seconds, 0),
                    updated_at = datetime('now')""",
            (review_id, annotator, *values, flagged, note, seconds),
        )
        conn.execute(
            f"INSERT INTO label_history (review_id, annotator, {cols}, flagged, note, seconds) "
            f"VALUES (?, ?, {marks}, ?, ?, ?)",
            (review_id, annotator, *values, flagged, note, seconds),
        )
        conn.execute("DELETE FROM claims WHERE review_id = ?", (review_id,))
        conn.execute("DELETE FROM skips WHERE review_id = ?", (review_id,))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return {"ok": True}


def skip_review(conn: sqlite3.Connection, body: dict) -> dict:
    review_id = int(body["review_id"])
    annotator = clean_annotator(body.get("annotator"))
    conn.execute("BEGIN IMMEDIATE")
    conn.execute(
        "INSERT INTO skips (review_id, annotator) VALUES (?, ?) "
        "ON CONFLICT DO UPDATE SET created_at = datetime('now')",
        (review_id, annotator),
    )
    conn.execute("DELETE FROM claims WHERE review_id = ? AND annotator = ?", (review_id, annotator))
    conn.execute("COMMIT")
    return {"ok": True}


class SuggestError(Exception):
    """The LLM call failed (no API key, network, provider error...)."""


def suggest_for_review(conn: sqlite3.Connection, body: dict, model: str) -> dict:
    """Run the LLM on one review, store the result in `suggestions` and return it.
    A stored suggestion from the same model is reused unless body["refresh"] is true."""
    review_id = int(body["review_id"])
    row = conn.execute("SELECT text FROM reviews WHERE id = ?", (review_id,)).fetchone()
    if row is None:
        raise LookupError("review not found")
    if not body.get("refresh"):
        cached = review_payload(conn, review_id)["suggestion"]
        if cached and cached["model"] == model:
            return {**cached, "cached": True}

    try:
        import suggest  # langchain is only needed when someone presses "Sugerir"

        result = suggest.suggest(row["text"], model)
    except Exception as e:  # surface any LLM/provider failure to the UI
        raise SuggestError(f"{type(e).__name__}: {e}") from e

    cols = ", ".join(DIMS)
    conn.execute(
        f"INSERT OR REPLACE INTO suggestions (review_id, model, prompt_hash, {cols}, justifications) "
        f"VALUES (?, ?, ?, {', '.join('?' for _ in DIMS)}, ?)",
        (review_id, model, result["prompt_hash"], *(result["scores"][d] for d in DIMS),
         json.dumps(result["justifications"], ensure_ascii=False)),
    )
    return {**review_payload(conn, review_id)["suggestion"], "cached": False}


def history(conn: sqlite3.Connection, annotator: str, limit: int) -> list[dict]:
    rows = conn.execute(
        "SELECT l.review_id, r.lang, substr(r.text, 1, 90) AS snippet, l.updated_at, l.flagged, "
        + ", ".join(f"l.{d}" for d in DIMS)
        + " FROM labels l JOIN reviews r ON r.id = l.review_id "
        "WHERE l.annotator = ? ORDER BY l.updated_at DESC, l.rowid DESC LIMIT ?",
        (annotator, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def stats(conn: sqlite3.Connection, annotator: str | None = None) -> dict:
    by_lang = {
        r["lang"]: {"total": r["total"], "labeled": r["labeled"], "skipped": r["skipped"]}
        for r in conn.execute(
            """SELECT r.lang, COUNT(*) AS total, COUNT(l.review_id) AS labeled,
                      SUM(l.review_id IS NULL
                          AND EXISTS (SELECT 1 FROM skips s WHERE s.review_id = r.id)) AS skipped
               FROM reviews r LEFT JOIN labels l ON l.review_id = r.id
               GROUP BY r.lang ORDER BY r.lang"""
        )
    }
    total = sum(v["total"] for v in by_lang.values())
    labeled = sum(v["labeled"] for v in by_lang.values())

    distribution = {}
    for d in DIMS:
        counts = {"N/A": 0, **{str(i): 0 for i in range(1, 6)}}
        for r in conn.execute(f"SELECT {d} AS v, COUNT(*) AS n FROM labels GROUP BY {d}"):
            counts["N/A" if r["v"] is None else str(r["v"])] = r["n"]
        distribution[d] = counts

    # How often the human label matches the LLM suggestion (only reviews that have both).
    agreement = {}
    for d in DIMS:
        r = conn.execute(
            f"""SELECT COUNT(*) AS n,
                       SUM(l.{d} IS s.{d}) AS exact,
                       SUM(l.{d} IS s.{d} OR ABS(l.{d} - s.{d}) = 1) AS near
                FROM labels l JOIN suggestions s ON s.review_id = l.review_id"""
        ).fetchone()
        agreement[d] = {"n": r["n"], "exact": r["exact"] or 0, "near": r["near"] or 0}

    annotators = [
        dict(r)
        for r in conn.execute(
            "SELECT annotator, COUNT(*) AS labeled, ROUND(AVG(seconds), 1) AS avg_seconds, "
            "SUM(flagged) AS flagged, "
            "SUM(updated_at >= datetime('now', 'start of day')) AS today "
            "FROM labels GROUP BY annotator ORDER BY labeled DESC"
        )
    ]
    out = {
        "total": total,
        "labeled": labeled,
        "skipped": sum(v["skipped"] for v in by_lang.values()),  # skipped and still unlabeled
        "flagged": conn.execute("SELECT COUNT(*) FROM labels WHERE flagged = 1").fetchone()[0],
        "by_lang": by_lang,
        "distribution": distribution,
        "agreement": agreement,
        "suggested": conn.execute("SELECT COUNT(*) FROM suggestions").fetchone()[0],
        "annotators": annotators,
        "active": conn.execute(
            "SELECT COUNT(DISTINCT annotator) FROM claims WHERE claimed_at > ?",
            (time.time() - CLAIM_TTL_S,),
        ).fetchone()[0],
    }
    if annotator:
        out["my_skipped"] = conn.execute(
            "SELECT COUNT(*) FROM skips s WHERE s.annotator = ? "
            "AND NOT EXISTS (SELECT 1 FROM labels l WHERE l.review_id = s.review_id)",
            (annotator,),
        ).fetchone()[0]
    return out


def clean_annotator(name) -> str:
    name = (name or "").strip()
    if not name or len(name) > 40:
        raise ValueError("annotator name is required (max 40 chars)")
    return name


# ----------------------------------------------------------------------- export


def export(db_path: Path, out: Path, include_flagged: bool) -> int:
    with closing(connect(db_path)) as conn:
        rows = conn.execute(
            "SELECT r.id, r.lang, r.text, r.source_en, r.rating, l.annotator, l.flagged, l.note, "
            + ", ".join(f"l.{d}" for d in DIMS)
            + " FROM labels l JOIN reviews r ON r.id = l.review_id"
            + ("" if include_flagged else " WHERE l.flagged = 0")
            + " ORDER BY r.id"
        ).fetchall()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix == ".csv":
        with out.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(rows[0].keys() if rows else ["id"])
            for r in rows:
                w.writerow(["N/A" if (k in DIMS and r[k] is None) else r[k] for k in r.keys()])
    else:  # jsonl: N/A is null
        with out.open("w", encoding="utf-8") as f:
            for r in rows:
                rec = {k: r[k] for k in r.keys() if k not in DIMS}
                rec["flagged"] = bool(rec["flagged"])
                rec["scores"] = {d: r[d] for d in DIMS}
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return len(rows)


# ----------------------------------------------------------------------- server


class Handler(BaseHTTPRequestHandler):
    db_path: Path = DEFAULT_DB
    suggest_model: str = DEFAULT_SUGGEST_MODEL

    def log_message(self, fmt, *args):  # keep the terminal quiet except for errors
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, fn):
        try:
            with closing(connect(self.db_path)) as conn:
                self.send_json(fn(conn))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            self.send_json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        except LookupError as e:
            self.send_json({"error": str(e)}, HTTPStatus.NOT_FOUND)
        except SuggestError as e:
            # Print the full cause in the server terminal; the UI only gets a one-line message.
            print(f"\n[Sugerir] {e}", file=sys.stderr)
            traceback.print_exception(e.__cause__ or e, file=sys.stderr)
            self.send_json({"error": str(e)}, HTTPStatus.BAD_GATEWAY)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        path = url.path

        if path in ("/", "/index.html"):
            body = (HERE / "index.html").read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/config":
            self.send_json({"dimensions": DIMENSIONS, "suggest_model": self.suggest_model})
        elif path == "/api/next":
            self.handle_api(
                lambda c: next_review(c, clean_annotator(q.get("annotator")), clean_lang(q.get("lang")))
            )
        elif path.startswith("/api/review/"):
            review_id = path.rsplit("/", 1)[1]
            self.handle_api(lambda c: open_review(c, int(review_id), q.get("annotator") or None))
        elif path == "/api/skipped":
            self.handle_api(lambda c: skipped_list(c, clean_lang(q.get("lang"))))
        elif path == "/api/history":
            self.handle_api(
                lambda c: history(c, clean_annotator(q.get("annotator")), int(q.get("limit", 200)))
            )
        elif path == "/api/stats":
            self.handle_api(lambda c: stats(c, q.get("annotator")))
        else:
            self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as e:
            return self.send_json({"error": str(e)}, HTTPStatus.BAD_REQUEST)
        routes = {
            "/api/label": save_label,
            "/api/skip": skip_review,
            "/api/suggest": lambda c, b: suggest_for_review(c, b, self.suggest_model),
        }
        fn = routes.get(urlparse(self.path).path)
        if fn is None:
            return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        self.handle_api(lambda c: fn(c, body))


# -------------------------------------------------------------------------- cli


def print_import(res: dict) -> None:
    print(
        f"Imported {res['added']} new reviews ({res['rows']} rows in CSV, "
        f"{res['duplicates']} duplicates dropped). DB now has {res['total']} reviews."
    )


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite file (default: {DEFAULT_DB.name})")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve", help="start the labeling UI (imports the subset on first run)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--csv", type=Path, default=DEFAULT_SUBSET)
    s.add_argument("--model", default=DEFAULT_SUGGEST_MODEL,
                   help=f"OpenRouter model for the Sugerir button (default: {DEFAULT_SUGGEST_MODEL})")

    i = sub.add_parser("import", help="(re)import a subset CSV with columns text,lang")
    i.add_argument("--csv", type=Path, default=DEFAULT_SUBSET)

    sub.add_parser("stats", help="print progress")

    e = sub.add_parser("export", help="export labels to .jsonl (N/A = null) or .csv (N/A = 'N/A')")
    e.add_argument("out", type=Path)
    e.add_argument("--include-flagged", action="store_true")

    args = p.parse_args(argv)

    if args.cmd == "import":
        print_import(import_subset(args.db, args.csv))
    elif args.cmd == "serve":
        init_db(args.db)
        with closing(connect(args.db)) as conn:
            empty = conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0] == 0
        if empty:
            print_import(import_subset(args.db, args.csv))
        Handler.db_path = args.db
        Handler.suggest_model = args.model
        if not os.environ.get("OPENROUTER_API_KEY"):
            print("Note: OPENROUTER_API_KEY is not set, the Sugerir button will not work.")
        server = ThreadingHTTPServer((args.host, args.port), Handler)
        print(f"Labeling tool on http://{args.host}:{args.port}  (db: {args.db})  Ctrl+C to stop")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print()
    elif args.cmd == "stats":
        with closing(connect(args.db)) as conn:
            st = stats(conn)
        print(
            f"Labeled {st['labeled']}/{st['total']} "
            f"({st['flagged']} flagged, {st['skipped']} skipped and still unlabeled)"
        )
        for lang, v in st["by_lang"].items():
            print(f"  {lang}: {v['labeled']}/{v['total']}  ({v['skipped']} skipped)")
        for a in st["annotators"]:
            avg = f"avg {a['avg_seconds']}s" if a["avg_seconds"] is not None else "no timing"
            print(f"  {a['annotator']}: {a['labeled']} labeled, {avg}")
        print("Distribution:")
        for d, counts in st["distribution"].items():
            print(f"  {d:<11} " + "  ".join(f"{k}:{v}" for k, v in counts.items()))
    elif args.cmd == "export":
        n = export(args.db, args.out, args.include_flagged)
        print(f"Wrote {n} labeled reviews to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
