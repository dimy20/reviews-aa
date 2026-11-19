"""Levanta y baja a mano el pod de RunPod que sirve Kev (Hy-MT2 y Qwen se usan por OpenRouter).

Uso (desde la raiz del repo):

    uv run python deploy_models.py up      # crea el pod `kev` (o reusa el que ya esta corriendo)
    uv run python deploy_models.py down    # borra los pods `kev` (deja de cobrar la GPU)

Es una interfaz de linea de comandos sobre engine/infra.py, el mismo codigo que usa la API:
la configuracion sale de infra.yaml y las claves del .env (via settings.py):

    RUNPOD_API_KEY=...    # para crear y borrar el pod
    KEV_API_KEY=...       # clave que va a pedir kev (cualquier string largo y random)
    HF_TOKEN=...          # para bajar los pesos de Hugging Face

Como funciona:
- No guarda nada local: RunPod es la fuente de verdad y el pod se identifica por el nombre `kev`.
  Para conseguir la URL desde codigo: engine.infra.get_active_pod(get_settings().infra.port).
- `up` prueba las GPUs de `devices` (infra.yaml) en orden, en secure cloud y en el datacenter del
  volume, y usa la primera libre. Si no hay ninguna, reintenta cada `wait_interval` s.
- Los pesos de kev (~9.5 GB) quedan en el network volume: el primer `up` los baja, los siguientes no.
  Kev tarda unos minutos en cargar; hasta entonces la URL devuelve 502.
- `down` borra los pods enteros; los pesos siguen en el volume.
- Ojo: si la API esta corriendo, su watcher borra cualquier pod `kev` que lleve 3 min sin requests,
  tambien el que levanta este script.
- Para llamar a kev: notebooks/05_modelos_desplegados/03_kev_etiquetado.ipynb.
- Logs de kev: consola de RunPod -> pod `kev` -> Logs.
"""

import argparse
import runpod

from engine.infra import PodError, provision_pod, terminate_kev_pods
from settings import get_settings


def handle_command_up():
    try:
        pod = provision_pod()
    except PodError as e:
        raise SystemExit(str(e))
    print("id:", pod["id"])
    print("kev:", pod["base_url"])
    print("health:", pod["health_url"])

def handle_command_down():
    ids = terminate_kev_pods()
    if not ids:
        raise SystemExit("No hay ningun pod `kev`, no hay nada que bajar.")
    print("ok:", ", ".join(ids))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Levanta y baja el pod de RunPod que sirve Kev.",
        epilog="Guia completa al principio de deploy_models.py.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("down", help="borra los pods `kev` (los pesos quedan en el network volume)")
    subparsers.add_parser("up", help="crea el pod `kev`, o reusa el que ya esta corriendo")

    args = parser.parse_args()

    # el SDK de RunPod no lee RUNPOD_API_KEY solo
    runpod.api_key = get_settings().runpod_api_key or runpod.api_key

    if args.command == "down":
        handle_command_down()
    elif args.command == "up":
        handle_command_up()
