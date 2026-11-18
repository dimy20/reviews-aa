from engine.aspects import load_aspects, ROOT, labeled_review_to_kev_format
from pathlib import Path
import pandas as pd
import json
import argparse

SAVE_PATH = ROOT / "reseñas" / "splits_en" / "kev"
SPLITS = ["train", "val", "test"]

def convert_to_kev_input(split: str, save_path: Path = SAVE_PATH):
    df = pd.read_csv(ROOT / "reseñas" / "splits_en" / f"{split}_en.csv")
    N = df.shape[0]
    instructions = load_aspects()
    aspect_columns = ["service", "price", "wait_time", "food", "experience"]
    examples = []

    save_path.mkdir(parents=True, exist_ok=True)

    with open(save_path / f"{split}.jsonl", "w", encoding="utf-8") as f:
        for i in range(N):
            aspect_ratings = []
            row = df.iloc[i]
            for c in aspect_columns:
                aspect_ratings.append((c, row[c].item()))

            ex = labeled_review_to_kev_format(row["text_en"], aspect_ratings, instructions)
            examples.append(ex)

            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Convert a labeled split to Kev's JSONL format.")
    parser.add_argument("split", choices=SPLITS, help="Which split to convert.")
    parser.add_argument(
        "--save-path",
        type=Path,
        default=SAVE_PATH,
        help=f"Directory to write <split>.jsonl into (default: {SAVE_PATH}).",
    )
    args = parser.parse_args()
    convert_to_kev_input(args.split, args.save_path)
