"""Corre el prompt de la API (engine/prompts/explain.txt, "explain") y las variantes de qwen/prompts/
sobre las reseñas que puntuó kev, y muestra lo que responde Qwen.

Necesita qwen/data/kev_ratings.json (lo genera qwen/sample_kev.py). No usa el pod de kev.
Va imprimiendo cada respuesta a medida que llega, y al final guarda todo en
qwen/results/<fecha>.md (para leer comparando) y .json.

    uv run python -m qwen.run                          # todos los prompts, todas las reseñas
    uv run python -m qwen.run -p explain               # solo esos prompts
    uv run python -m qwen.run -n 3                     # solo las primeras 3 reseñas

A Qwen le llega la reseña original (en, es o pt) con los puntajes que kev le puso a la traducción.
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime

from qwen.common import DIMS, KEV_RATINGS_PATH, RESULTS_DIR, explain, load_prompts
from settings import ROOT


def header(r: dict) -> str:
    rows = "\n".join(
        f"| {d} | {r['kev'][d]['choice']} ({r['kev'][d]['confidence']:.2f}) | {r['human'][d]} |" for d in DIMS
    )
    stars = f", {r['stars']} estrellas" if r.get("stars") else ""
    # la traducción es lo que leyó kev; se muestra solo si la reseña no estaba en inglés
    translation = f"Traducción (lo que leyó kev):\n\n> {r['text_en']}\n\n" if r["text_en"] != r["text"] else ""
    return (
        f"## Reseña {r['id']} ({r['lang']}{stars})\n\n> {r['text']}\n\n{translation}"
        f"| dimensión | kev (confianza) | humano |\n|---|---|---|\n{rows}\n"
    )


# async porque engine/explain.py lo es (es lo que usa la API); acá las reseñas van de a una
async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-p", "--prompts", nargs="*", help="nombres de prompts (sin .txt); default todos")
    parser.add_argument("-n", type=int, help="cuántas reseñas usar; default todas")
    parser.add_argument("--temperature", type=float, default=0.3)
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")

    if not KEV_RATINGS_PATH.exists():
        sys.exit(f"No existe {KEV_RATINGS_PATH.relative_to(ROOT)}: corré primero uv run python -m qwen.sample_kev")

    reviews = json.loads(KEV_RATINGS_PATH.read_text(encoding="utf-8"))["reviews"][: args.n]
    prompts = load_prompts()
    if args.prompts:
        missing = set(args.prompts) - prompts.keys()
        if missing:
            sys.exit(f"No existen los prompts: {', '.join(sorted(missing))}. Hay: {', '.join(prompts)}")
        prompts = {k: v for k, v in prompts.items() if k in args.prompts}

    md = [f"# Prompts de explicación ({datetime.now():%Y-%m-%d %H:%M})\n\nPrompts: {', '.join(prompts)}\n"]
    results = []

    for r in reviews:
        block = header(r)
        print("\n" + "=" * 80 + "\n" + block)
        md.append(block)
        for name, template in prompts.items():
            try:
                # Qwen recibe la reseña original (para citar en su idioma) y los puntajes que kev
                # le puso a la traducción
                answer = await explain(template, r["text"], r["kev"], temperature=args.temperature)
                text = json.dumps(answer, ensure_ascii=False, indent=2)
            except Exception as e:
                answer = text = f"ERROR: {e}"
            print(f"--- {name}\n{text}\n")
            md.append(f"### {name}\n\n```json\n{text}\n```\n")
            results.append({"review_id": r["id"], "prompt": name, "answer": answer})

    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = f"{datetime.now():%Y%m%d_%H%M%S}"
    (RESULTS_DIR / f"{stamp}.md").write_text("\n".join(md), encoding="utf-8")
    (RESULTS_DIR / f"{stamp}.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Guardado en qwen/results/{stamp}.md y .json")


if __name__ == "__main__":
    asyncio.run(main())
