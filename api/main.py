from contextlib import asynccontextmanager
import asyncio
import runpod

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.db import get_connection, init_db
from settings import get_settings
from engine.infra import provision_pod, PodResource, watch_pod_activity

@asynccontextmanager
async def lifespan(app: FastAPI):
    runpod.api_key = get_settings().runpod_api_key or runpod.api_key
    init_db()
    watcher = asyncio.create_task(watch_pod_activity())  # borra el pod si nadie lo usa
    yield
    watcher.cancel()

app = FastAPI(title="Reviews API", lifespan=lifespan)

# The dashboard is served from another origin (port), and there's no login yet,
# so allow any origin (see dashboard/README.md).
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class AnalyzeRequest(BaseModel):
    text: str
    user: str

@app.get("/reviews")
def list_reviews():
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM reviews ORDER BY id DESC").fetchall()
    return [dict(row) for row in rows]

@app.post("/reviews/analyze")
def analyze_review(request: AnalyzeRequest, pod: PodResource = Depends(provision_pod)):
    return {
        "request": request
    }