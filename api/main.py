"""La API. Dos rutas:

    GET  /reviews/         todas las reseñas, para el dashboard
    POST /reviews/analyze  recibe una reseña del formulario, la guarda y la analiza de fondo

Todo es async: mientras una reseña espera a los modelos, la API sigue atendiendo a las demás.
"""
from contextlib import asynccontextmanager
import asyncio
import json

import runpod
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from api import db
from api.analyze import analyze
from engine.infra import watch_pod_activity
from engine.lang import load_model as load_lang_model
from settings import get_settings


# ---------------------------------------------------------------------------
# Arranque
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    runpod.api_key = get_settings().runpod_api_key or runpod.api_key  # el SDK no lee el .env solo
    db.init_db()                                          # crea la tabla reviews si no existe
    await asyncio.to_thread(load_lang_model)              # fastText: al arrancar, no en el primer request
    watcher = asyncio.create_task(watch_pod_activity())   # borra el pod de kev si nadie lo usa
    yield
    watcher.cancel()


app = FastAPI(title="Reviews API", lifespan=lifespan)

# El dashboard corre en otro origen (otro puerto) y no hay login: se permite cualquier origen.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------------------
# Formato de entrada y de salida
# ---------------------------------------------------------------------------
class AnalyzeRequest(BaseModel):
    """Lo que manda el formulario (dashboard/opinar.html). Sin estrellas: el análisis sale
    solo del texto."""
    model_config = ConfigDict(str_strip_whitespace=True)  # "   " cuenta como vacío
    text: str = Field(min_length=1, max_length=5000)
    name: str | None = Field(default=None, max_length=100)


def to_dashboard(row: dict) -> dict:
    """Una fila de la tabla reviews en el formato de Reseña del dashboard (dashboard/README.md)."""
    explanations = json.loads(row["explanations"]) if row["explanations"] else {}
    per_dim = [explanations.get(d) or {} for d in db.DIMS]
    return {
        "id": row["id"],
        "text": row["text"],        # original: lo que escribió el cliente
        "text_en": row["text_en"],  # la traducción que leyó kev
        "lang": row["lang"],
        "name": row["name"],
        "source": "Formulario",
        "date": row["created_at"].replace(" ", "T") + "Z",  # SQLite guarda UTC sin zona
        "status": row["status"],    # 'pending' | 'done' | 'error'
        "error": row["error"],      # por qué falló, si status = 'error'
        "pending": row["status"] != "done",  # todavía sin puntajes (en análisis o falló)
        # en la base N/A es -1 y sin puntuar es NULL; el dashboard usa null para los dos
        "scores": [None if row[d] in (None, -1) else row[d] for d in db.DIMS],
        "quotes": [d.get("quote") for d in per_dim],          # citas de la reseña (Qwen)
        "evidence": [d.get("explanation") for d in per_dim],  # explicaciones en español (Qwen)
    }


# ---------------------------------------------------------------------------
# Rutas
# ---------------------------------------------------------------------------
@app.get("/reviews/")
@app.get("/reviews", include_in_schema=False)  # las dos, así ninguna redirige
async def list_reviews():
    rows = await db.list_reviews()
    return {"dims": db.DIMS, "reviews": [to_dashboard(r) for r in rows]}


@app.post("/reviews/analyze", status_code=202)
async def analyze_review(request: AnalyzeRequest, background: BackgroundTasks):
    # 1. Se guarda primero: si después falla algún modelo, la reseña no se pierde.
    review_id = await db.insert_review(request.text, request.name or None)
    # 2. El análisis (pod -> idioma -> traducción -> kev -> Qwen, api/analyze.py) corre de fondo,
    #    después de responder: el cliente ve el "gracias" enseguida, aunque kev tarde.
    background.add_task(analyze, review_id, request.text)
    # 3. Se devuelve como quedó: status 'pending'. El dashboard la ve terminada en el próximo GET.
    return to_dashboard(await db.get_review(review_id))
