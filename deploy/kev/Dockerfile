# Image de Kev que usa deploy_models.py (enzost4/kev:1.0). Build desde la raiz del repo:
#
#   docker build --platform linux/amd64 -t enzost4/kev:1.0 deploy/kev
#   docker push enzost4/kev:1.0
#
FROM nvidia/cuda:12.8.1-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

COPY --from=ghcr.io/astral-sh/uv:0.12.2 /uv /usr/local/bin/uv

# kev
ADD https://github.com/jaredpalmer/kev.git#kev-1.0 /opt/kev
WORKDIR /opt/kev

ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra serve

# RunPod load balancing sends traffic to PORT and health checks (/ping) to PORT_HEALTH,
# both 80 by default. kev listens on KEV_PORT, so all three must match.
# Expose this same port under "Expose HTTP Ports" on the endpoint.
ENV KEV_PORT=8000 PORT=8000 PORT_HEALTH=8000
ENV KEV_RUN=jaredpalmer/kev-4b@v1.0
# Serverless monta el network volume en /runpod-volume (no /workspace, eso es en Pods).
# Sin el volume, cada worker nuevo baja los weights de nuevo.
ENV HF_HOME=/runpod-volume/huggingface

# kev.serve + GET /ping (RunPod health check)
COPY serve_runpod.py /opt/kev/serve_runpod.py

# Exec form ([...]) does not expand $VARS, so run through sh. `exec` keeps python as PID 1
# so it receives docker stop's SIGTERM directly.
CMD ["sh", "-c", "exec .venv/bin/python serve_runpod.py --run \"$KEV_RUN\" --host 0.0.0.0 --port \"$KEV_PORT\""]
