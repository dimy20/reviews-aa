# Labeling tool image. Build context is the repo root (it needs pyproject/uv.lock,
# the reviews CSVs and the few-shot prompt, not just tools/labeling).
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
# The cache mount keeps uv's download cache out of the image layers.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

COPY few_shot_etiquetado_resenas.md ./
COPY reseñas/ reseñas/
COPY tools/labeling/ tools/labeling/

# The database lives in /data, mounted as a volume so it survives rebuilds.
VOLUME /data
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/config', timeout=4)"

# 0.0.0.0 inside the container is fine: the port is never published to the host,
# only Caddy reaches it over the compose network.
CMD ["python", "tools/labeling/app.py", "--db", "/data/labels.db", "serve", "--host", "0.0.0.0", "--port", "8765"]
