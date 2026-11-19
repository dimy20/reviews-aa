from contextlib import asynccontextmanager
import runpod

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.db import get_connection, init_db
from settings import get_settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    runpod.api_key = get_settings().runpod_api_key or runpod.api_key
    init_db()
    yield


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
def analyze_review(request: AnalyzeRequest):
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO reviews (user, text) VALUES (?, ?)",
            (request.user, request.text),
        )
        row = conn.execute("SELECT * FROM reviews WHERE id = ?", (cur.lastrowid,)).fetchone()
    return dict(row)
