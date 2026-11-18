from pathlib import Path
from typing import List, Tuple
import glob
ROOT = Path(__file__).resolve().parent.parent
ASPECTS_DIR = ROOT / "engine" / "instructions"

IGNORE_OTHER_ASPECTS_INSTRUCTION = """
    Rate only this aspect, independently of the others. Do not infer it from the review's overall tone
    its enthusiasm, or mentions of other aspects.
"""

CRITERIA = {
    "1": "Very negative",
    "2": "Negative",
    "3": "Mixed or acceptable",
    "4": "Positive",
    "5": "Very positive",
    "N/A": "The review does not give enough evidence to rate this aspect",
}

def load_aspects() -> dict:
    aspects = glob.glob(str(ASPECTS_DIR / "*"))
    ans = {}
    for a in aspects:
        with open(a, "r", encoding="utf-8") as f:
            text = f.read()
            aspect_name = a.split("/")[-1].split(".")[0]
            ans[aspect_name] = f"{text}\n\n{IGNORE_OTHER_ASPECTS_INSTRUCTION}"
    return ans

def labeled_review_to_kev_format(review_text: str, ratings: List[Tuple[str, int]], aspect_instructions: dict):
    example = {"state": review_text, "questions": {}}
    for aspect, rating in ratings:
        question = {
            "type": "choice",
            "instructions": aspect_instructions[aspect],
            "criteria": CRITERIA ,
            "label": str(rating) if rating != -1 else "N/A"
        }
        example["questions"][aspect] = question
    return example