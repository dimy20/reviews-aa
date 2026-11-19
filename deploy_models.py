"""Levanta y baja el pod de RunPod que sirve Kev (Hy-MT2 y Qwen se usan por OpenRouter).

Uso (desde la raiz del repo):

    uv run python deploy_models.py up      # crea el pod y guarda su URL en models/config.json
    uv run python deploy_models.py down    # borra el pod (deja de cobrar la GPU)

Antes de usarlo, en el .env de la raiz:

    RUNPOD_API_KEY=...    # para crear y borrar el pod
    KEV_API_KEY=...    # clave que va a pedir kev (cualquier string largo y random)
    HF_TOKEN=...          # opcional, para bajar los pesos de Hugging Face

Como funciona:
- `up` prueba las GPUs de POD_GPU_OPTIONS en orden (secure cloud, datacenter del volume) y usa la primera
  libre. Si no hay ninguna, reintenta cada 30 s hasta 10 min (Ctrl+C para cortar).
- Los pesos de kev (~9.5 GB) quedan en el network volume NETWORK_VOLUME_ID: el primer `up` los baja,
  los siguientes no. Kev tarda unos minutos en cargar; hasta entonces la URL devuelve 502.
- `down` borra el pod entero; los pesos siguen en el volume. Si ya hay un pod en models/config.json,
  `up` no crea otro.
- Para llamar a kev: notebooks/05_modelos_desplegados/03_kev_etiquetado.ipynb (lee la URL de
  models/config.json y manda `Authorization: Bearer $KEV_API_KEY`).
- Logs de kev: consola de RunPod -> pod `kev` -> Logs.
"""

import os
import argparse
import runpod
from dotenv import load_dotenv
import json
import logging
import time

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("deploy_models")

load_dotenv()

RUNPOD_API_KEY = os.environ.get("RUNPOD_API_KEY")
runpod.api_key = RUNPOD_API_KEY
CONFIG_PATH = "./models"

# --- Pod con Kev (Hy-MT2 y Qwen se usan por OpenRouter) ---

KEV_IMAGE = "enzost4/kev:1.0"         # kev listo en /opt/kev; arranca su server solo
KEV_PORT = 8000                       # el KEV_PORT del image

# Network volume (15 GB) montado en /runpod-volume: el image guarda ahi los pesos (HF_HOME=/runpod-volume/huggingface).
# No esta atado a una maquina, asi que `down` borra el pod y `up` crea uno nuevo en cualquier GPU libre del datacenter.
NETWORK_VOLUME_ID = "ibyodt24ki"
POD_DATACENTER = "EU-RO-1"            # el del volume: el pod tiene que estar en el mismo datacenter

# GPUs de EU-RO-1 en secure cloud, en orden de preferencia ($/h aprox.). Kev necesita ~10 GB
# (Qwen3.5-4B-Base en bf16 + el adapter). Primero las de 20 GB, despues las de 16 GB (mas justas).
POD_GPU_OPTIONS = [
    ("NVIDIA RTX A4500", "SECURE"),                   # 0.25, 20 GB
    ("NVIDIA RTX 4000 Ada Generation", "SECURE"),     # 0.28, 20 GB
    ("NVIDIA RTX 2000 Ada Generation", "SECURE"),     # 0.24, 16 GB
    ("NVIDIA RTX A4000", "SECURE"),                   # 0.25, 16 GB
    ("NVIDIA RTX PRO 4000 Blackwell", "SECURE"),      # 0.57, 24 GB
    ("NVIDIA L4", "SECURE"),                          # 0.69, 24 GB
    ("NVIDIA GeForce RTX 4090", "SECURE"),            # 0.89, 24 GB
]
# si no hay ninguna GPU libre se reintenta cada CREATE_WAIT_S
CREATE_ATTEMPTS = 20
CREATE_WAIT_S = 30   # 20 x 30 s = 10 min

def create_kev_pod(name: str = "kev") -> dict:
    api_key = os.environ.get("KEV_API_KEY")
    if not api_key:
        raise SystemExit("Falta KEV_API_KEY en .env (la clave que pide kev)")

    pod = None
    for attempt in range(1, CREATE_ATTEMPTS + 1):
        for gpu, cloud in POD_GPU_OPTIONS:
            try:
                pod = _create_pod(name, gpu, cloud, api_key)
                log.info("GPU: %s (%s)", gpu, cloud)
                break
            except runpod.error.QueryError as e:
                log.info("%s (%s): %s", gpu, cloud, e)
        if pod is not None:
            break
        if attempt < CREATE_ATTEMPTS:
            log.warning("intento %d/%d: ninguna GPU libre en %s -> retrying en %ds (Ctrl+C para cortar)",
                        attempt, CREATE_ATTEMPTS, POD_DATACENTER, CREATE_WAIT_S)
            time.sleep(CREATE_WAIT_S)
    if pod is None:
        raise SystemExit(f"No hubo ninguna GPU libre en {POD_DATACENTER} despues de {CREATE_ATTEMPTS} intentos, proba en un rato.")

    pod_id = pod["id"]
    url = f"https://{pod_id}-{KEV_PORT}.proxy.runpod.net"
    print("id:", pod_id)
    print("kev:", url)
    return {"id": pod_id, "url": url}

def _create_pod(name: str, gpu: str, cloud: str, api_key: str) -> dict:
    return runpod.create_pod(
        name=name,
        image_name=KEV_IMAGE,
        gpu_type_id=gpu,
        cloud_type=cloud,
        gpu_count=1,
        container_disk_in_gb=20,
        network_volume_id=NETWORK_VOLUME_ID,
        data_center_id=POD_DATACENTER,
        volume_mount_path="/runpod-volume",
        ports=f"{KEV_PORT}/http,22/tcp",
        env={
            "KEV_API_KEY": api_key,           # kev pide Authorization: Bearer <key> en /v1
            "HF_TOKEN": os.environ.get("HF_TOKEN", ""),
        },
        # el mismo comando del image, explicito. Sin comillas dobles: el SDK no las escapa.
        docker_args="bash -c 'exec .venv/bin/python serve_runpod.py --run $KEV_RUN --host 0.0.0.0 --port $KEV_PORT'",
    )

def handle_command_up():
    config = _read_config()

    if config:
        pod_id = next(iter(config.values()))["id"]
        print(f"Ya hay un pod ({pod_id}), `down` primero si queres uno nuevo:")
        for k, e in config.items():
            print(f"{k}: {e['urls']['base']}")
        return

    pod = create_kev_pod()
    _write_config({
        "kev": {"type": "pod", "name": "kev", "id": pod["id"], "urls": {"base": pod["url"], "health": f"{pod['url']}/ping"}}
    })

CONFIG_FILE = f"{CONFIG_PATH}/config.json"

def _read_config() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return {}
    with open(CONFIG_FILE) as f:
        return json.load(f)

def _write_config(config: dict):
    os.makedirs(CONFIG_PATH, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        f.write(json.dumps(config, indent=4))

def handle_command_down_all():
    config = _read_config()
    if not config:
        raise SystemExit(f"Nada en {CONFIG_FILE}, no hay nada que bajar.")

    # se borra el pod entero: los pesos quedan en el network volume para el proximo `up`
    pod_id = next(iter(config.values()))["id"]
    print(f"Terminating pod {pod_id}...")
    runpod.terminate_pod(pod_id)
    _write_config({})
    print("ok")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Levanta y baja el pod de RunPod que sirve Kev.",
        epilog="Guia completa al principio de deploy_models.py.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("down", help="borra el pod (los pesos quedan en el network volume)")
    subparsers.add_parser("up", help="crea el pod y guarda su URL en models/config.json")

    args = parser.parse_args()

    if args.command == "down":
        handle_command_down_all()
    elif args.command == "up":
        handle_command_up()
