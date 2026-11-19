# CLAUDE.md

Análisis de reseñas de restaurantes por aspecto: cada reseña (en, es o pt) recibe un puntaje de 1 a 5, o N/A, en cinco dimensiones, y un dashboard las muestra agregadas. El `README.md` explica el porqué y el modelo; este archivo explica dónde está cada cosa y cómo se conecta.

## Flujo

El pipeline se arma y se expone en `api/`: `POST /reviews/analyze` va a encadenar estos pasos y guardar el resultado. Las piezas de cada paso (traducir, puntuar, explicar) viven en `engine/`; `api/` las orquesta y las expone por HTTP. Hoy la ruta solo guarda la reseña, sin correr ningún paso.

```
reseña (en/es/pt)
  -> detectar idioma (langdetect)                       main.py: detect_lang (script suelto, todavía no lo usa la API)
  -> traducir a inglés si es es/pt (Hy-MT2, OpenRouter)  engine/pipeline.py: translate_to_english
  -> kev-4b puntúa las 5 dimensiones (pod en RunPod)     engine/pipeline.py: kev_assing_ratings   (sin implementar)
  -> un LLM explica cada puntaje (Qwen, OpenRouter)      engine/pipeline.py: explain_kev_ratings  (sin implementar)
  -> se guarda en SQLite                                 api/ (POST /reviews/analyze)
  -> el dashboard la muestra                             dashboard/ (GET /reviews)
```

kev no es un LLM generativo: recibe un texto (`state`) y preguntas tipadas (`questions`), y devuelve una distribución de probabilidad por pregunta. Cada dimensión es una pregunta `Choice` cuyas instrucciones salen de `engine/instructions/`.

## Las cinco dimensiones

Los nombres son los mismos en todo el repo (columnas de las bases, archivos de instrucciones, claves de kev, `dims` del dashboard), siempre en este orden:

`food`, `wait_time`, `service`, `price`, `experience`

Valores posibles: 1–5 o N/A. **Cómo se guarda N/A depende del lugar:**

| Lugar | N/A | Sin puntuar todavía |
|---|---|---|
| `api/reviews.db` (tabla `reviews`) | `-1` | `NULL` |
| `reseñas/labels.db` y `tools/labeling/labels.db` | `NULL` | (no hay fila en `labels`) |
| kev (entrada y salida) | `"N/A"` (string; los puntajes también son strings: `"1"`…`"5"`) | — |
| `engine/aspects.py` | `-1` en los splits, se convierte a `"N/A"` para kev | — |
| dashboard (`scores`) | `null` | — |

## Estructura

```
api/                 API FastAPI: acá se arma y se expone el pipeline (reseñas que llegan del formulario)
  main.py            app, lifespan, CORS y rutas GET /reviews, POST /reviews/analyze
  db.py              conexión SQLite + esquema de la tabla reviews (init_db)
  Dockerfile
engine/              las piezas de cada paso del pipeline, compartidas por la API y los scripts
  pipeline.py        traducción, KevRatings, puntuar y explicar (las dos últimas sin implementar)
  aspects.py         carga engine/instructions/ y arma ejemplos en formato kev
  instructions/      un .txt por dimensión: la pregunta que se le hace a kev
  infra.py           levanta el pod de kev en RunPod (o reusa el que ya está corriendo)
settings.py          toda la configuración: get_settings()
infra.yaml           imagen, volumen, datacenter, puerto y GPUs del pod de kev
dashboard/           HTML/CSS/JS sin build (ver dashboard/README.md)
  js/config.js       configuración; apiBase sale de js/env.js
  js/env.js          API_BASE; vacío = modo demostración. En Docker se reescribe al arrancar
  docker/40-env.sh   genera js/env.js desde la variable API_BASE
  scripts/build_data.py  regenera data/reviews.json desde reseñas/labels.db
tools/
  labeling/          herramienta web de etiquetado manual (ver tools/labeling/README.md)
  data.py            convierte un split etiquetado a JSONL para fine-tunear kev
deploy/
  kev/               imagen Docker de kev (enzost4/kev:1.0) + serve_runpod.py (/ping)
  Caddyfile, *.env   producción de la herramienta de etiquetado (HTTPS + contraseña)
deploy_models.py     CLI para levantar/bajar el pod a mano (up/down), sobre engine/infra.py
reseñas/             datos: CSVs por idioma, labels.db, splits/ y splits_en/ (+ splits_en/kev/*.jsonl)
data/                CSVs originales en español y portugués
notebooks/           experimentos numerados (dataset, detección de idioma, traductores, modelos desplegados)
few_shot_etiquetado_resenas.md  prompt few-shot y criterios de etiquetado (la referencia de cada dimensión)
main.py              script suelto de detección de idioma
compose.yaml         stack de la herramienta de etiquetado (app + Caddy)
compose.app.yaml     stack de la API + dashboard
```

## Configuración

Todo pasa por `settings.py`:

```python
from settings import get_settings
s = get_settings()
s.kev_api_key, s.openrouter_api_key, s.runpod_api_key, s.hf_token
s.reviews_db_path        # api/reviews.db; en Docker /data/reviews.db
s.infra.devices          # lo de infra.yaml, validado
```

- Los secretos van en `.env` en la raíz (nunca se versiona ni entra en las imágenes): `RUNPOD_API_KEY`, `KEV_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`. Una variable exportada en la shell le gana a `.env`.
- `KEV_API_KEY` es la clave que pide el servidor de kev (`Authorization: Bearer ...`); el pod la recibe con ese mismo nombre.
- El SDK de RunPod no lee `RUNPOD_API_KEY` solo (usa `~/.runpod/config.toml`): hay que asignar `runpod.api_key = get_settings().runpod_api_key`, como hace el `lifespan` de `api/main.py`.
- `tools/labeling/` todavía lee `os.environ` directo: es una imagen aparte y no usa `settings.py`.
- Código nuevo: leer configuración con `get_settings()`, no con `os.environ` ni `load_dotenv`.

## Cómo correr las cosas

Siempre desde la raíz del repo. Los scripts importan `engine`, `api` y `settings` como paquetes, así que se corren con `-m`, no por ruta (`python tools/data.py` falla con `No module named 'engine'`). No hay `python` en el PATH: usar `uv run` o `.venv/bin/python`.

```bash
uv sync                                         # dependencias (uv sync --all-groups para los notebooks de ML)

# API en local (http://127.0.0.1:8000/docs)
uv run uvicorn api.main:app --reload

# API + dashboard en Docker (dashboard :8080, API :8000, solo en 127.0.0.1)
docker compose -f compose.app.yaml up -d --build
docker compose -f compose.app.yaml down         # down -v borra también la base

# Dashboard sin Docker: abrir dashboard/index.html con Live Server (modo demostración)

# Datos para fine-tunear kev: reseñas/splits_en/<split>_en.csv -> reseñas/splits_en/kev/<split>.jsonl
uv run python -m tools.data train               # train | val | test, opcional --save-path DIR

# Herramienta de etiquetado
uv run tools/labeling/app.py serve              # http://127.0.0.1:8765

# Notebooks
./jupyter.sh
```

### Pod de kev en RunPod

La API levanta el pod a demanda y lo borra cuando nadie lo usa. Todo está en `engine/infra.py`, que es la única fuente de cómo se levanta, se encuentra y se borra el pod: la API, `deploy_models.py` y los notebooks lo usan.

**Levantar: `provision_pod()`**, dependencia (`Depends`) de `POST /reviews/analyze`, así que corre en cada request. Lee `infra.yaml` y:

1. Le pide a RunPod los pods de la cuenta (`runpod.get_pods()`) y busca uno llamado `kev` en `RUNNING`. Si lo hay, lo devuelve sin crear otro. No hay estado local: RunPod es la fuente de verdad, y el nombre `kev` es lo que identifica al pod.
2. Si no hay ninguno, prueba las GPUs de `devices` en orden (cada `wait_interval` s, hasta `max_attempts` intentos) y crea el pod. Mientras tanto el request queda esperando (hasta ~10 min si no hay GPU libre).

Devuelve `{id, base_url, health_url}`; las URLs se arman con el id y el `port` de `infra.yaml` (`health_url` = `<base_url>/ping`). Devuelve el pod apenas RunPod lo crea, sin esperar a que kev cargue: quien llame a kev tiene que tolerar los 502 del arranque.

- Si falta `KEV_API_KEY` o `HF_TOKEN`, o no hubo GPU libre, lanza `PodError`; `api/main.py` lo convierte en un **503** con el motivo. No usar `SystemExit` en `engine/`: corre dentro de requests.
- `POD_LOCK` hace que buscar-o-crear (y el borrado del watcher) sea de a uno. Dos requests sin pod crean **un** pod: el segundo espera al primero y lo reusa.

**Borrar por inactividad: `watch_pod_activity()`**, tarea de fondo que arranca y se cancela en el `lifespan` de `api/main.py`.

- `EXPIRES_AT` (en memoria) es cuándo se borra el pod, y `KNOWN_POD_ID` es el pod al que corresponde ese plazo.
- Cada `provision_pod()` corre el plazo a ahora + `MAX_POD_INACTIVITY` (3 min); si el pod es nuevo, suma `BOOT_GRACE` (2 min) porque tarda en cargar kev. El plazo se corre al empezar cada request (cuando corre la dependencia), no al terminar.
- Cada 60 s (`_check_pod`, con `POD_LOCK` tomado) le pregunta a RunPod por el pod `kev` corriendo:
  - **No hay pod:** no hace nada.
  - **Pod con un id que la API no conocía** (lo levantó `deploy_models.py up`, o la API recién arranca o se reinició): le da una ventana completa de 3 + 2 min desde que lo ve, sin borrarlo. Así un pod del script no hereda un plazo viejo y se borra recién levantado, ni vive para siempre porque la API no lo tenía en cuenta. Y un reinicio nunca deja una GPU cobrando: el pod que ya estuviera corriendo se borra si no llega ningún request en esa ventana. Los reinicios del modo watch solo vuelven a dar la ventana.
  - **El mismo pod y pasó `EXPIRES_AT`:** lo **termina** (`runpod.terminate_pod`). Deja de cobrar del todo, y los pesos siguen en el network volume. El próximo request crea uno nuevo y espera a que arranque.
- Como mira con el lock tomado, no puede borrar un pod que un request acaba de recibir: ese request ya corrió el plazo.
- Borra **cualquier** pod `kev` ocioso mientras la API corre, también uno levantado con `deploy_models.py up`. Para tener un pod que no se borre solo, frenar la API o usar otro nombre.
- Las llamadas a RunPod bloquean, así que el watcher las corre con `asyncio.to_thread`. Si fallan, lo avisa en el log y reintenta en la próxima vuelta.
- El estado (plazo, id, lock) es de cada proceso: `deploy_models.py` no lo comparte con la API. Lo que sí comparten es RunPod, así que los dos ven el mismo pod. Si el script y la API crean un pod en el mismo momento puede haber dos `kev`; se usa el primero y se avisa en el log.

- No usar el nombre `kev` para otros pods de la cuenta: se confundirían con este. Si hay varios `kev` corriendo, usa el primero y lo avisa en el log. Los pods frenados no se reusan (se avisa en el log, porque siguen cobrando el disco).

- Siempre **secure cloud** (`cloud_type="SECURE"`), nunca community.
- Crear un pod **empieza a cobrar**. El pod tarda unos minutos en cargar kev; hasta entonces la URL devuelve 502.
- Los pesos de kev quedan en el network volume de `infra.yaml`, que está en un datacenter fijo: el pod tiene que estar en el mismo.
- `deploy_models.py` es solo una CLI sobre `engine/infra.py`: `up` llama a `provision_pod()` y `down` a `terminate_kev_pods()`, que borra todos los pods `kev` (corriendo o frenados). Si la API está corriendo, su watcher ve el pod del script como nuevo, le da 5 min (3 + 2 de arranque) desde que lo ve, y lo borra si en ese tiempo no llega ningún request (cada request le da 3 min más).
- Para la URL del pod desde cualquier lado (scripts, notebooks): `get_active_pod(get_settings().infra.port)`, después de asignar `runpod.api_key`. No hay archivo de configuración con la URL.

## Bases de datos

| Archivo | Quién la usa | Tablas |
|---|---|---|
| `api/reviews.db` (en Docker: volumen `api-data`, `/data/reviews.db`) | API | `reviews` (de `api/db.py: init_db`, que corre en el lifespan) |
| `reseñas/labels.db` | etiquetas humanas de referencia, `dashboard/scripts/build_data.py` | `reviews`, `labels`, `label_history`, `skips`, `claims`, `suggestions` |
| `tools/labeling/labels.db` | la herramienta de etiquetado en local | mismo esquema |

`CREATE TABLE IF NOT EXISTS` no modifica una tabla existente: si cambia un esquema, la base vieja hay que migrarla o recrearla.

## Docker

- `compose.app.yaml` (proyecto `reviews-app`): `api` (`api/Dockerfile`, contexto la raíz) y `dashboard` (`dashboard/Dockerfile`, nginx). La API recibe los secretos con `env_file: .env`. El dashboard recibe `API_BASE`, la URL de la API **vista desde el navegador** (por defecto `http://localhost:${API_PORT:-8000}`). Puertos configurables con `API_PORT` y `DASHBOARD_PORT`.
- `compose.yaml` (proyecto `reviews`): la herramienta de etiquetado detrás de Caddy, para el droplet. Solo Caddy publica puertos.
- Los puertos publicados por Docker saltean ufw: publicar solo en `127.0.0.1` o detrás de Caddy.
- `.dockerignore` deja afuera `.env*`, `*.db`, `notebooks/`, `docs/` y `deploy/`.

## Estado actual / pendientes

- `kev_assing_ratings` y `explain_kev_ratings` en `engine/pipeline.py` están vacías: `POST /reviews/analyze` guarda la reseña con los puntajes en `NULL`.
- El dashboard espera otro contrato que el que da la API (ver `dashboard/README.md`): manda `{text, rating, name}` (la API pide `user`) y espera `GET /reviews/` -> `{dims, reviews}` con `scores` en lista. Con `apiBase` configurado, el formulario hoy recibe 422.
- `KevRatings` (`engine/pipeline.py`) usa `"N/A"`, mientras que `api/reviews.db` usa `-1`: hay que convertir al guardar.

## Convenciones

- Docs, READMEs y mensajes de log en español; identificadores en inglés.
- SQL inline con el prefijo `"""--sql` y parámetros `?`, nunca f-strings.
- Dependencias con `uv add`; `uv.lock` se versiona.
