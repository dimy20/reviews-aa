import runpod
import time
import logging
from settings import InfraSettings, get_settings
from typing import TypedDict
import asyncio
import threading

class PodResource(TypedDict):
    id: str
    base_url: str
    health_url: str

class CreatePodResult(TypedDict):
    resource: PodResource
    new: bool

EXPIRES_AT = 0
MAX_POD_INACTIVITY = 60 * 3 # 3 minutos
BOOT_GRACE = 120 # un par de minutos, pq el pod demora un poco en inicializar
# el pod al que corresponde EXPIRES_AT. Un pod `kev` con otro id (deploy_models.py, un reinicio
# de la API) es nuevo para esta API: recibe una ventana completa en vez de heredar un plazo viejo
KNOWN_POD_ID = None

# un solo find-or-create (o terminate) a la vez: sin esto, dos requests sin pod crean dos pods
POD_LOCK = threading.Lock()

class PodError(RuntimeError):
    """No hay pod y no se pudo crear (falta una clave o no hay GPU libre). La API responde 503."""

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("infra")

def _pod_urls(pod_id: str, port: int) -> PodResource:
    base_url = f"https://{pod_id}-{port}.proxy.runpod.net"
    health_url = f"{base_url}/ping"  # served by deploy/kev/serve_runpod.py
    return {"id": pod_id, "base_url": base_url, "health_url": health_url}

def get_active_pod(port: int, name: str = "kev") -> PodResource | None:
    """Ask RunPod for a running pod called `name`. RunPod is the source of truth: no local state."""
    pods = [p for p in runpod.get_pods() if p["name"] == name]
    running = [p for p in pods if p["desiredStatus"] == "RUNNING"]

    stopped = len(pods) - len(running)
    if stopped:
        # A stopped pod still bills its disk; it isn't reused, so it's worth knowing about.
        log.info("hay %d pod(s) '%s' frenados (no se reusan)", stopped, name)

    if not running:
        return None

    if len(running) > 1:
        # Names aren't unique on RunPod: two provisions at once, or one created by hand.
        log.warning("hay %d pods '%s' corriendo: %s. Uso el primero",
                    len(running), name, ", ".join(p["id"] for p in running))

    return _pod_urls(running[0]["id"], port)

def create_kev_pod(infra: InfraSettings, name: str = "kev") -> CreatePodResult:
    active = get_active_pod(infra.port, name)
    if active is not None:
        log.info("ya hay un pod activo: %s", active["id"])
        return CreatePodResult(resource=active, new=False)

    settings = get_settings()
    api_key = settings.kev_api_key
    hf_token = settings.hf_token

    if not api_key:
        raise PodError("Falta KEV_API_KEY")

    if not hf_token:
        raise PodError("Falta HF_TOKEN")

    max_attempts = infra.max_attempts
    devices = infra.devices  # list of gpus
    wait_interval = infra.wait_interval
    data_center = infra.data_center
    port = infra.port
    image_name = infra.image
    network_volume_id = infra.network_volume_id
    kev_run = infra.run

    pod = None

    for attempt in range(1, max_attempts+ 1):
        for device in devices:
            try:
                pod = _create_pod(
                    name=name,
                    image_name=image_name,
                    network_volume_id=network_volume_id,
                    data_center_id=data_center,
                    port=port,
                    gpu=device,
                    api_key=api_key,
                    hf_token=hf_token,
                    run=kev_run
                )
                log.info("GPU: %s ", device)
                break
            except runpod.error.QueryError as e:
                log.info("%s : %s", device, e)

        if pod is not None:
            break

        if attempt < max_attempts:
            log.warning("intento %d/%d: ninguna GPU libre en %s -> retrying en %ds (Ctrl+C para cortar)",
                        attempt, max_attempts, data_center, wait_interval)

            time.sleep(wait_interval)

    if pod is None:
        raise PodError(f"No hubo ninguna GPU libre en {data_center} despues de {max_attempts} intentos, proba en un rato.")

    return CreatePodResult(
        resource=_pod_urls(pod["id"], port),
        new=True
    )

def _create_pod(name: str,
                image_name: str,
                network_volume_id: str,
                data_center_id: str,
                port: int,
                gpu: str,
                api_key: str,
                hf_token: str,
                run: str = None) -> dict:

    return runpod.create_pod(
        name=name,
        image_name=image_name,
        gpu_type_id=gpu,
        cloud_type="SECURE",
        gpu_count=1,
        container_disk_in_gb=20,
        network_volume_id=network_volume_id,
        data_center_id=data_center_id,
        volume_mount_path="/runpod-volume",
        ports=f"{port}/http,22/tcp",
        env={
            "KEV_API_KEY": api_key,
            "HF_TOKEN": hf_token,
            "KEV_RUN": run
        },
        docker_args="bash -c 'exec .venv/bin/python serve_runpod.py --run $KEV_RUN --host 0.0.0.0 --port $KEV_PORT'",
    )

async def watch_pod_activity():
    while True:
        try:
            # cada vuelta le pregunta a RunPod: asi ve tambien los pods que no creo esta API
            await asyncio.to_thread(_check_pod)
        except Exception as e:
            log.warning("Failed to check pod, retying in 60s: %s", e)
        await asyncio.sleep(60)

def _check_pod():
    global EXPIRES_AT, KNOWN_POD_ID
    with POD_LOCK:
        pod = get_active_pod(get_settings().infra.port)
        now = time.time()

        if pod is None:
            KNOWN_POD_ID = None
            EXPIRES_AT = 0
            return

        if pod["id"] != KNOWN_POD_ID:
            # pod que esta API no conocia (deploy_models.py, o la API recien arranco): ventana completa.
            # asi un reinicio nunca deja una GPU cobrando, y nunca se borra un pod recien levantado
            KNOWN_POD_ID = pod["id"]
            EXPIRES_AT = now + MAX_POD_INACTIVITY + BOOT_GRACE
            log.info("pod %s nuevo para la API, se borra si no se usa en %ds", pod["id"], MAX_POD_INACTIVITY + BOOT_GRACE)
            return

        if now >= EXPIRES_AT:
            log.info("pod %s inactive for %ds, deleting...", pod["id"], MAX_POD_INACTIVITY)
            runpod.terminate_pod(pod["id"])
            KNOWN_POD_ID = None
            EXPIRES_AT = 0

def terminate_kev_pods(name: str = "kev") -> list[str]:
    """Borra todos los pods llamados `name`, corriendo o frenados. Devuelve los ids borrados."""
    global EXPIRES_AT, KNOWN_POD_ID
    with POD_LOCK:
        ids = [p["id"] for p in runpod.get_pods() if p["name"] == name]
        for pod_id in ids:
            log.info("borrando pod %s", pod_id)
            runpod.terminate_pod(pod_id)
        KNOWN_POD_ID = None
        EXPIRES_AT = 0
    return ids

def provision_pod() -> PodResource:
    global EXPIRES_AT, KNOWN_POD_ID
    settings = get_settings()
    with POD_LOCK:
        res = create_kev_pod(settings.infra)

        now = time.time()
        KNOWN_POD_ID = res["resource"]["id"]
        EXPIRES_AT = now + MAX_POD_INACTIVITY

        if res.get("new"):
            EXPIRES_AT += BOOT_GRACE

    return res.get("resource")