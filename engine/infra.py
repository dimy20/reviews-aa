import runpod
import time
import logging
from api.db import get_connection
from settings import InfraSettings, get_settings

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("infra")

def get_active_pod(name: str = "kev") -> dict | None:
    """Return the most recent active pod saved under `name` if RunPod says it's still running."""
    conn = get_connection()
    row = conn.execute(
        """--sql
        SELECT id, base_url, health_url FROM pods
        WHERE name = ? AND is_active = 1
        ORDER BY rowid DESC LIMIT 1
        """,
        (name,),
    ).fetchone()

    if row is None:
        conn.close()
        return None

    try:
        pod = runpod.get_pod(row["id"])
    except runpod.error.QueryError:
        pod = None  # RunPod errors out on ids it no longer knows

    status = pod.get("desiredStatus") if pod else None

    if status != "RUNNING":
        log.info("pod %s ya no esta activo (%s), lo marco inactivo", row["id"], status or "terminado")
        with conn:  # commits the update
            conn.execute("UPDATE pods SET is_active = 0 WHERE id = ?", (row["id"],))
        conn.close()
        return None

    conn.close()
    return dict(row)

def create_kev_pod(infra: InfraSettings, name: str = "kev") -> dict:
    active = get_active_pod(name)
    if active is not None:
        log.info("ya hay un pod activo: %s", active["id"])
        return active

    settings = get_settings()
    api_key = settings.kev_api_key
    hf_token = settings.hf_token

    if not api_key:
        raise SystemExit("Falta KEV_API_KEY")

    if not api_key:
        raise SystemExit("Falta HF_TOKEN")

    max_attempts = infra.max_attempts
    devices = infra.devices  # list of gpus
    wait_interval = infra.wait_interval
    data_center = infra.data_center
    port = infra.port
    image_name = infra.image
    network_volume_id = infra.network_volume_id

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
                    hf_token=hf_token
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
        raise SystemExit(f"No hubo ninguna GPU libre en {data_center} despues de {max_attempts} intentos, proba en un rato.")

    pod_id = pod["id"]
    base_url = f"https://{pod_id}-{port}.proxy.runpod.net"
    health_url = f"{base_url}/ping"  # served by deploy/kev/serve_runpod.py

    conn = get_connection()
    with conn:  # commits the insert
        conn.execute(
            """--sql
            INSERT INTO pods (id, type, name, base_url, health_url)
            VALUES (?, ?, ?, ?, ?)
            """,
            (pod_id, "pod", name, base_url, health_url),
        )
    conn.close()
    return {"id": pod_id, "base_url": base_url, "health_url": health_url}

def _create_pod(name: str,
                image_name: str,
                network_volume_id: str,
                data_center_id: str,
                port: int,
                gpu: str,
                api_key: str,
                hf_token: str) -> dict:

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
        },
        docker_args="bash -c 'exec .venv/bin/python serve_runpod.py --run $KEV_RUN --host 0.0.0.0 --port $KEV_PORT'",
    )

def provision_gpu():
    settings = get_settings()
    print(create_kev_pod(settings.infra))