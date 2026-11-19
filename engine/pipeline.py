from typing import Literal, TypedDict
from openrouter import OpenRouter
from settings import get_settings
from engine.infra import get_active_pod
import httpx


MODEL = "tencent/hy-mt2-1.8b"

LANGS = {
    "es": "spanish",
    "pt": "portuguese"
}

Rating = Literal[1, 2, 3, 4, 5, "N/A"]

class KevRatings(TypedDict):
    food: Rating
    price: Rating
    experience: Rating
    wait_time: Rating
    service: Rating

# el container de kev demora en inicializarse, esto sive para saber si esta 'healthy'
def is_kev_healthy() -> bool:
    settings = get_settings()
    r = get_active_pod(settings.infra.port)

    if not r:
        return False

    health_url = r.get("health_url")
    response = httpx.get(health_url, timeout=10)

    return response.status_code == 200

# traduce el texto original a ingles de spanol o portugues
def translate_to_english(text: str, src: Literal["es", "pt"]) -> str:
    client = OpenRouter(api_key=get_settings().openrouter_api_key)

    if src not in LANGS:
        raise ValueError(f"Invalid src language {src}")

    language = LANGS[src]

    prompt = f"""
        Translate the following text in {language} to english.
        Note that you should only output the translated result wihtout any aditional explanation or formatting, text only.
        Text:\n\n
        {text}
    """
    res = client.chat.send(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2048,
        temperature=0.7,
    )

    return res.choices[0].message.content.strip()

# Recibe un review, genere ratings para cada aspecto
def kev_assing_ratings(review: str) -> None | KevRatings:
    if not is_kev_healthy():
        return None

    return KevRatings(food=4, price=2, experience="N/A", wait_time="N/A", service=3)

# recibe ratings generados por kev, genera una explicacion a partir de la review y los ratings
def explain_kev_ratings(review: str, ratings: KevRatings) -> str:
    pass