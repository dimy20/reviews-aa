# Reviews API image. Build context is the repo root (it needs pyproject/uv.lock,
# settings.py, engine/ and infra.yaml, not just api/).
FROM python:3.11-slim

# uv, pinned to the version used to write uv.lock
COPY --from=ghcr.io/astral-sh/uv:0.12.2 /uv /usr/local/bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH=/app/.venv/bin:$PATH

# Dependencies first, in their own layer: rebuilding after a code change reuses it.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY settings.py infra.yaml ./
COPY api/ api/
COPY engine/ engine/
COPY migrations/ migrations/

# The SQLite database lives in /data, mounted as a volume so it survives rebuilds.
ENV REVIEWS_DB_PATH=/data/reviews.db
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/reviews', timeout=4)"

# The migration creates the pods table on a fresh volume (IF NOT EXISTS, so re-running is safe);
# the reviews table is created by the app's lifespan.
CMD ["sh", "-c", "python -m migrations.create_pods_table && exec uvicorn api.main:app --host 0.0.0.0 --port 8000"]
