"""Genera dashboard/data/reviews.json a partir de reseñas/labels.db.

Une cada reseña etiquetada con su fecha original (CSVs de reseñas/) y la
justificación de la IA (tabla suggestions) como evidencia.

    uv run dashboard/scripts/build_data.py
"""
import csv
import json
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "reseñas"
OUT = ROOT / "dashboard" / "data" / "reviews.json"
DIMS = ["food", "wait_time", "service", "price", "experience"]

csv.field_size_limit(10**8)


def load_dates():
    dates = {}
    for name in ["resenas_ingles.csv", "resenas_espanol_trad.csv", "resenas_portugues_trad.csv"]:
        with open(SRC / name, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    d = datetime.strptime(row["Date"].strip(), "%m/%d/%Y").date().isoformat()
                except ValueError:
                    continue
                for k, v in row.items():
                    if k.startswith("Review Text") and v:
                        dates.setdefault(v.strip(), d)
    return dates


def main():
    dates = load_dates()
    db = sqlite3.connect(SRC / "labels.db")
    db.row_factory = sqlite3.Row
    rows = db.execute(
        f"""SELECT r.id, r.text, r.lang, r.rating, r.source_en,
                   {', '.join('l.' + d for d in DIMS)}, s.justifications
            FROM reviews r JOIN labels l ON l.review_id = r.id
            LEFT JOIN suggestions s ON s.review_id = r.id
            ORDER BY r.id"""
    ).fetchall()
    out, missing = [], 0
    for r in rows:
        date = dates.get(r["text"].strip()) or dates.get((r["source_en"] or "").strip())
        missing += date is None
        item = {
            "id": r["id"],
            "date": date,
            "lang": r["lang"],
            "rating": r["rating"],
            "text": r["text"],
            "scores": [r[d] for d in DIMS],  # None = N/A
        }
        if r["justifications"]:
            j = json.loads(r["justifications"])
            item["evidence"] = [j.get(d) if r[d] is not None else None for d in DIMS]
        out.append(item)
    OUT.write_text(json.dumps({"dims": DIMS, "reviews": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} reseñas -> {OUT} ({OUT.stat().st_size/1e6:.1f} MB), sin fecha: {missing}")


if __name__ == "__main__":
    main()
