# CLAUDE.md

Análisis de reseñas de restaurantes por aspecto: cada reseña (en, es o pt) recibe un puntaje de 1 a 5, o N/A, en cinco dimensiones, y un dashboard las muestra agregadas. El `README.md` explica el porqué y el modelo; este archivo explica dónde está cada cosa y cómo se conecta.

## Flujo

El pipeline se arma y se expone en `api/`: `POST /reviews/analyze` guarda la reseña, responde enseguida (202, `status = 'pending'`) y encadena estos pasos de fondo (`api/analyze.py`); el dashboard la ve terminada en el próximo `GET`. Las piezas de cada paso viven en `engine/`; `api/` las orquesta y las expone por HTTP. Todo es async, para que muchas reseñas a la vez no se esperen entre sí.

```
reseña (en/es/pt)
  -> detectar idioma (fastText, models/lid.176.ftz)      engine/lang.py: detect_lang
  -> traducir a inglés si es es/pt (Hy-MT2, OpenRouter)  engine/pipeline.py: translate_to_english
  -> kev fine-tuneado puntúa la traducción (RunPod)      engine/pipeline.py: kev_assing_ratings   (qué modelo: `run` de infra.yaml)
  -> Qwen explica con la reseña ORIGINAL (OpenRouter)    engine/explain.py: explain_kev_ratings
  -> se guarda en SQLite, paso por paso                  api/analyze.py, api/db.py
  -> el dashboard la muestra                             dashboard/ (GET /reviews/)
```

kev lee el inglés (`text_en`) y Qwen el original (`text`): la cita sale en el idioma del cliente y la explicación en español. Si un paso falla, la reseña queda con `status = 'error'` y el motivo en `error`; lo hecho hasta ahí queda guardado.

kev no es un LLM generativo: recibe un texto (`state`) y preguntas tipadas (`questions`), y devuelve una distribución de probabilidad por pregunta. Cada dimensión es una pregunta `Choice` cuyas instrucciones salen de `engine/instructions/`. Las mismas instrucciones se usan para armar los datos de fine-tuning (`engine/aspects.py`), así kev recibe en producción las preguntas con las que se entrenó.

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
  main.py            app, lifespan, CORS, rutas GET /reviews/, POST /reviews/analyze y to_dashboard
  analyze.py         el pipeline de una reseña: encadena los pasos y guarda cada uno
  db.py              esquema de la tabla reviews (init_db) y consultas async (asyncio.to_thread)
  Dockerfile
engine/              las piezas de cada paso del pipeline, compartidas por la API y los scripts
  lang.py            detección de idioma con fastText (en/es/pt)
  pipeline.py        traducción (Hy-MT2) y kev (AsyncTypeSafeClient: espera /ping, reintenta, 4 a la vez)
  explain.py         Qwen: prompt, schema JSON, chequeo de citas y explain_kev_ratings
  prompts/explain.txt  el prompt de Qwen que usa la API
  openrouter.py      un solo cliente de OpenRouter para todo el proceso
  aspects.py         carga engine/instructions/ y arma ejemplos en formato kev
  instructions/      un .txt por dimensión: la pregunta que se le hace a kev
  infra.py           levanta el pod de kev en RunPod (o reusa el que ya está corriendo)
qwen/                pruebas de prompts de Qwen sin la API: sample_kev.py (puntúa con kev) y run.py
  data/kev_ratings.json  lo que devolvió kev (sample_kev.py); run.py lo lee sin necesitar el pod
  results/           lo que respondió Qwen en cada corrida (.md para leer, .json)
models/lid.176.ftz   modelo de fastText (lo copia api/Dockerfile)
settings.py          toda la configuración: get_settings()
infra.yaml           imagen, volumen, datacenter, puerto, GPUs y modelo (`run`) del pod de kev
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
kev_results/         fine-tuning de kev (ver "Fine-tuning de kev")
  base-eval/<split>/       eval de kev-4b base sobre train, val y test
  fine_tuned/eval/<split>/ el mismo eval con el fine-tuneado
  fine_tuned/results/      config y métricas del entrenamiento; los pesos no se versionan
reseñas/             datos: CSVs por idioma, labels.db, splits/ y splits_en/ (+ splits_en/kev/*.jsonl)
data/                CSVs originales en español y portugués
notebooks/           experimentos numerados: 01 dataset, 02 detección de idioma, 03 traductores,
                     05 modelos desplegados (cómo llamar a Hy-MT2, Qwen y kev), 06 eval del fine-tuning.
                     Sueltos: 2_training_subset (qué reseñas etiquetar), 3_kev_test, 4_processing_labels (splits)
few_shot_etiquetado_resenas.md  prompt few-shot y criterios de etiquetado (la referencia de cada dimensión)
main.py              script suelto de detección de idioma con langdetect (la API usa engine/lang.py)
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
s.lid_model_path         # models/lid.176.ftz (fastText)
s.infra.devices          # lo de infra.yaml, validado
s.infra.run              # el modelo que carga el pod (KEV_RUN)
```

- Los secretos van en `.env` en la raíz (nunca se versiona ni entra en las imágenes): `RUNPOD_API_KEY`, `KEV_API_KEY`, `OPENROUTER_API_KEY`, `HF_TOKEN`. Una variable exportada en la shell le gana a `.env`.
- `KEV_API_KEY` es la clave que pide el servidor de kev (`Authorization: Bearer ...`); el pod la recibe con ese mismo nombre.
- El SDK de RunPod no lee `RUNPOD_API_KEY` solo (usa `~/.runpod/config.toml`): hay que asignar `runpod.api_key = get_settings().runpod_api_key`, como hace el `lifespan` de `api/main.py`.
- `tools/labeling/` todavía lee `os.environ` directo: es una imagen aparte y no usa `settings.py`.
- Código nuevo: leer configuración con `get_settings()`, no con `os.environ` ni `load_dotenv`.

## Cómo correr las cosas

Siempre desde la raíz del repo. Los scripts importan `engine`, `api` y `settings` como paquetes, así que se corren con `-m`, no por ruta (`python tools/data.py` falla con `No module named 'engine'`). No hay `python` en el PATH: usar `uv run` o `.venv/bin/python`.

```bash
uv sync                                         # dependencias de la API (uv sync --all-groups para los notebooks de ML)

# API en local (http://127.0.0.1:8000/docs)
uv run uvicorn api.main:app --reload

# API + dashboard en Docker (dashboard :8080, API :8000, solo en 127.0.0.1)
docker compose -f compose.app.yaml up -d --build
docker compose -f compose.app.yaml down         # down -v borra también la base

# Dashboard sin Docker: abrir dashboard/index.html con Live Server (modo demostración)

# Datos para fine-tunear kev: reseñas/splits_en/<split>_en.csv -> reseñas/splits_en/kev/<split>.jsonl
uv run python -m tools.data train               # train | val | test, opcional --save-path DIR

# Pod de kev a mano (crear un pod empieza a cobrar)
uv run python deploy_models.py up              # o down

# Probar prompts de Qwen sin la API
uv run python -m qwen.sample_kev                # puntúa reseñas de test con kev (levanta el pod y lo borra)
uv run python -m qwen.run                       # Qwen sobre esas reseñas -> qwen/results/

# Herramienta de etiquetado
uv run tools/labeling/app.py serve              # http://127.0.0.1:8765

# Notebooks
./jupyter.sh
```

### Pod de kev en RunPod

La API levanta el pod a demanda y lo borra cuando nadie lo usa. Todo está en `engine/infra.py`, que es la única fuente de cómo se levanta, se encuentra y se borra el pod: la API, `deploy_models.py` y los notebooks lo usan.

**Levantar: `provision_pod()`**, que `api/analyze.py` llama al empezar el análisis de cada reseña (con `asyncio.to_thread`, porque RunPod bloquea). Lee `infra.yaml` y:

1. Le pide a RunPod los pods de la cuenta (`runpod.get_pods()`) y busca uno llamado `kev` en `RUNNING`. Si lo hay, lo devuelve sin crear otro. No hay estado local: RunPod es la fuente de verdad, y el nombre `kev` es lo que identifica al pod.
2. Si no hay ninguno, prueba las GPUs de `devices` en orden (cada `wait_interval` s, hasta `max_attempts` intentos) y crea el pod. Mientras tanto el análisis de esa reseña queda esperando (hasta ~10 min si no hay GPU libre); el cliente no, porque el POST ya respondió.

Devuelve `{id, base_url, health_url}`; las URLs se arman con el id y el `port` de `infra.yaml` (`health_url` = `<base_url>/ping`). Devuelve el pod apenas RunPod lo crea, sin esperar a que kev cargue: quien llame a kev tiene que tolerar los 502 del arranque.

- Si falta `KEV_API_KEY` o `HF_TOKEN`, o no hubo GPU libre, lanza `PodError`; la reseña queda con `status = 'error'` y el motivo (`pod de kev: ...`). No usar `SystemExit` en `engine/`: corre dentro de la API.
- `POD_LOCK` hace que buscar-o-crear (y el borrado del watcher) sea de a uno. Dos requests sin pod crean **un** pod: el segundo espera al primero y lo reusa.

**Borrar por inactividad: `watch_pod_activity()`**, tarea de fondo que arranca y se cancela en el `lifespan` de `api/main.py`.

- `EXPIRES_AT` (en memoria) es cuándo se borra el pod, y `KNOWN_POD_ID` es el pod al que corresponde ese plazo.
- Cada `provision_pod()` corre el plazo a ahora + `MAX_POD_INACTIVITY` (3 min); si el pod es nuevo, suma `BOOT_GRACE` (2 min) porque tarda en cargar kev. El plazo se corre al empezar cada análisis, no al terminar.
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
- Los pesos de kev quedan en el network volume de `infra.yaml`, que está en un datacenter fijo: el pod tiene que estar en el mismo. El volume se monta en `/runpod-volume`.
- **Qué modelo carga el pod: `run` de `infra.yaml`.** `create_kev_pod` lo pasa al pod como `KEV_RUN`, que le gana al default de la imagen (`jaredpalmer/kev-4b@v1.0`, en `deploy/kev/Dockerfile`). Hoy apunta al fine-tuneado en Hugging Face, `enzost98/kev-reviews@v1`: el pod lo baja con `HF_TOKEN` la primera vez y queda cacheado en el volume (`HF_HOME=/runpod-volume/huggingface`). Para volver al base, `run: jaredpalmer/kev-4b@v1.0`. Solo afecta a los pods nuevos: uno que ya está corriendo sigue con el modelo con que arrancó.
- `deploy_models.py` es solo una CLI sobre `engine/infra.py`: `up` llama a `provision_pod()` y `down` a `terminate_kev_pods()`, que borra todos los pods `kev` (corriendo o frenados). Si la API está corriendo, su watcher ve el pod del script como nuevo, le da 5 min (3 + 2 de arranque) desde que lo ve, y lo borra si en ese tiempo no llega ningún request (cada request le da 3 min más).
- Para la URL del pod desde cualquier lado (scripts, notebooks): `get_active_pod(get_settings().infra.port)`, después de asignar `runpod.api_key`. No hay archivo de configuración con la URL.

## Fine-tuning de kev

```
reseñas/labels.db (etiquetas humanas, tools/labeling/)
  -> reseñas/splits/<split>.csv           70/15/15 estratificado por etiqueta, igual por idioma (notebooks/4_processing_labels.ipynb)
  -> reseñas/splits_en/<split>_en.csv     es/pt traducidas con Hy-MT2 (notebooks/03_traductor_pipeline/02_traducir_splits_hymt.ipynb)
  -> reseñas/splits_en/kev/<split>.jsonl  formato de kev: uv run python -m tools.data <split>
  -> entrenamiento y eval en un pod aparte (no está en este repo)
  -> kev_results/                         config, métricas y evals que salieron de ahí
  -> notebooks/06_kev_eval/finetune_results.ipynb  base vs fine-tuneado
```

- En cada `.jsonl`, `state` es la reseña en inglés y `questions` las cinco preguntas con su `label` (`"1"`…`"5"` o `"N/A"`).
- El entrenamiento y el eval dejan afuera las reseñas de más de 384 tokens (`max_state`): ~28 en train, 9 en val y 8 en test. Quedan en `rejected.json` y son las mismas para los dos modelos. Al servir el límite es otro (`SERVE_MAX_STATE`, 65 536 en kev.serve): la API sí puntúa reseñas largas, pero su calidad no está medida.
- En `rows.json` de los evals, `label` es el **índice** en `keys` (`["1".."5", "N/A"]`), no el puntaje.
- Run `kev-reviews-1`: LoRA rango 16 sobre `jaredpalmer/kev-4b`, 2 épocas, lr 2e-5, head congelado (`head_lr` 0), sin pérdida ordinal (`ord_w` 0).
- En test contra el base: NLL 0.53 -> 0.39, accuracy con etiqueta 1–5 0.75 -> 0.79. Lo más flojo sigue siendo `wait_time` y la confusión 4 vs 5. En train el NLL baja a 0.26: memoriza algo, pero val y test mejoran igual.
- Los pesos (`adapter_model.safetensors` ~130 MB, `head.pt`, tokenizer) están en `.gitignore`: GitHub rechaza archivos de más de 100 MB. Viven en [enzost98/kev-reviews](https://huggingface.co/enzost98/kev-reviews), un repo público con acceso **gated**: para bajarlos hay que aceptar los términos de uso académico (se aprueba solo). La model card es `kev_results/fine_tuned/results/README.md`.
- Bajarlos: `uvx --from huggingface_hub hf download enzost98/kev-reviews --revision v1 --local-dir kev_results/fine_tuned/results` (con un token de una cuenta que aceptó los términos).
- El repo también trae `questions.json`: las cinco preguntas tal como se entrenaron (instrucciones de `engine/instructions/` + la regla común de `engine/aspects.py`, y los criterios). Es lo que usa el ejemplo de la model card, así quien baja el modelo tiene las preguntas de esa versión.
- Un fine-tune nuevo: regenerar `questions.json` desde `engine/aspects.py` si cambiaron las instrucciones, subir la carpeta al mismo repo con un tag nuevo (`v2`, ...) y cambiar `run` en `infra.yaml`. Hace falta un token con permiso de escritura; el `HF_TOKEN` del `.env` es de solo lectura, porque es el que recibe el pod.
- **Uso académico solamente:** se entrenó con reseñas de Yelp, cuyos términos no permiten uso comercial. La licencia es `cc-by-nc-4.0` y la model card lo dice arriba de todo.

## Bases de datos

| Archivo | Quién la usa | Tablas |
|---|---|---|
| `api/reviews.db` (en Docker: volumen `api-data`, `/data/reviews.db`) | API | `reviews` (de `api/db.py: init_db`, que corre en el lifespan): `text` original, `text_en` para kev, puntajes, `explanations` (JSON de Qwen) y `status` |
| `reseñas/labels.db` | etiquetas humanas de referencia, `dashboard/scripts/build_data.py` | `reviews`, `labels`, `label_history`, `skips`, `claims`, `suggestions` |
| `tools/labeling/labels.db` | la herramienta de etiquetado en local | mismo esquema |

`CREATE TABLE IF NOT EXISTS` no modifica una tabla existente: si cambia un esquema, la base vieja hay que migrarla o recrearla.

## Docker

- `compose.app.yaml` (proyecto `reviews-app`): `api` (`api/Dockerfile`, contexto la raíz) y `dashboard` (`dashboard/Dockerfile`, nginx). La API recibe los secretos con `env_file: .env`. El dashboard recibe `API_BASE`, la URL de la API **vista desde el navegador** (por defecto `http://localhost:${API_PORT:-8000}`). Puertos configurables con `API_PORT` y `DASHBOARD_PORT`.
- `compose.yaml` (proyecto `reviews`): la herramienta de etiquetado detrás de Caddy, para el droplet. Solo Caddy publica puertos.
- Los puertos publicados por Docker saltean ufw: publicar solo en `127.0.0.1` o detrás de Caddy.
- `.dockerignore` deja afuera `.env*`, `*.db`, `notebooks/`, `docs/` y `deploy/`.

## Estado actual / pendientes

- `KEV_MODEL = "kev-latest"` (`engine/pipeline.py`) es el nombre de modelo que manda el cliente; qué pesos carga el pod lo decide `run` de `infra.yaml`. El docstring y el comentario `PENDIENTE` de `engine/pipeline.py` todavía dicen que se usa el kev base.
- `api/analyze.py` llama a `provision_pod` (en otro hilo) al empezar cada análisis y le pasa el pod a `kev_assing_ratings`. Si el pod es nuevo, el análisis espera a que kev cargue (~3 min, hasta `KEV_BOOT_TIMEOUT`); con el pod ya prendido tarda unos segundos. El cliente no espera: el POST ya respondió. Para no esperar, levantarlo antes con `deploy_models.py up`, teniendo en cuenta que el watcher lo borra tras 5 min sin reseñas.
- La API ya usa el contrato del dashboard: recibe `{text, name}` (sin estrellas: el análisis sale solo del texto) y `GET /reviews/` devuelve `{dims, reviews}` con `scores`, `quotes` y `evidence` en listas (`to_dashboard` en `api/main.py`).
- Las rutas son `async`: todo lo que bloquea (sqlite3, RunPod) va con `asyncio.to_thread`, y las llamadas a modelos tienen que usar los clientes async (`chat.send_async`, `AsyncTypeSafeClient`). Una llamada sincrónica dentro de una ruta `async` frena a todas las demás.
- `KevRatings` (`engine/pipeline.py`) usa `"N/A"` y `api/reviews.db` usa `-1`: `db.save_scores` hace la conversión.
- `qwen/run.py` menciona variantes de prompt en `qwen/prompts/`, pero esa carpeta no existe: hoy solo corre `engine/prompts/explain.txt`.
- `docs/architecture.png` está desactualizado: el traductor dice MarianMT / NLLB (es Hy-MT2) y el paso 4 un "LLM liviano" (es Qwen3.5-9B por OpenRouter).

## Convenciones

- Docs, READMEs y mensajes de log en español; identificadores en inglés.
- SQL inline con el prefijo `"""--sql` y parámetros `?`, nunca f-strings.
- Dependencias con `uv add`; `uv.lock` se versiona.
