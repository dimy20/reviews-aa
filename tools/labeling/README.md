# Herramienta de etiquetado

Interfaz web local para puntuar las reseñas de `reseñas/training_subset.csv` en las 5 dimensiones (1–5 o N/A). Sin dependencias: Python stdlib + SQLite (`labels.db`).

```bash
uv run tools/labeling/app.py serve                  # http://127.0.0.1:8765
uv run tools/labeling/app.py serve --host 0.0.0.0   # para que el equipo etiquete desde la red local
uv run tools/labeling/app.py stats                  # progreso en la terminal
uv run tools/labeling/app.py export labels.jsonl    # o labels.csv; --include-flagged para incluir marcadas
```

El primer `serve` importa el CSV. `import` se puede volver a correr: solo agrega filas nuevas. Abrir `/?annotator=nombre&lang=pt` fija el anotador y el idioma.

## Cómo acelera el etiquetado

- **Todo con teclado**: `1`–`5` puntúa la dimensión activa y pasa a la siguiente, `0`/`n` = N/A, `Enter` guarda y carga la siguiente. Una reseña típica son 6 teclas.
- **Sin dimensiones olvidadas**: no se puede guardar hasta que las 5 tengan valor (N/A es explícito). El botón muestra cuántas faltan y, si se intenta guardar, se marcan en rojo y el foco salta a la primera. El servidor también lo rechaza.
- **Resaltado de palabras clave** por dimensión en en/es/pt (`h` lo apaga).
- **Pistas**: estrellas de Yelp y el original en inglés de las reseñas traducidas (`e`).
- **Varios anotadores a la vez**: cada reseña se reserva 15 min para quien la abrió, así nadie repite trabajo.
- `⌫` vuelve a la anterior para corregirla, `s` salta, `f` marca para discutir (con nota), `i` estadísticas y distribución de puntajes, `?` guía de criterios.
- **Por idioma**: el selector del encabezado (Todos / EN / ES / PT, tecla `g`) limita la cola a un idioma; la barra de progreso y el contador siguen al idioma elegido.
- **Ninguna saltada se pierde**: una reseña saltada sale de la cola normal y queda en la lista **Saltadas** (`x`), visible para todo el equipo con quién la saltó. Desde ahí se abre (queda reservada para ti) y al guardarla pasa a la siguiente de la lista. Cuando la cola normal se termina, las saltadas se sirven solas, así que "no quedan reseñas" significa que de verdad no queda ninguna.

## Botón Sugerir (IA)

**✨ Sugerir** (o `a`) manda la reseña actual a un LLM (LangChain + OpenRouter, salida estructurada) con el prompt few-shot de `few_shot_etiquetado_resenas.md` y completa las dimensiones que todavía no elegiste. Lo ya elegido no se toca. La sugerencia queda con **borde punteado** y su justificación bajo cada dimensión: revisa, corrige y guarda con `Enter`.

```bash
export OPENROUTER_API_KEY=...
uv run tools/labeling/app.py serve                                     # modelo por defecto: openai/gpt-4o-mini
uv run tools/labeling/app.py serve --model google/gemini-3.5-flash-lite
```

Cada sugerencia se guarda en `suggestions`; volver a pulsar Sugerir la reutiliza (sin costo), "regenerar" pide una nueva. Estadísticas (`i`) muestra cuánto coinciden las etiquetas humanas con la IA. El código del LLM está en `suggest.py`.

## Datos

| Tabla | Contenido |
|---|---|
| `reviews` | texto, idioma, orden aleatorio (seed 42, mezcla idiomas), rating de Yelp, original en inglés |
| `labels` | una fila por reseña etiquetada: `food`, `wait_time`, `service`, `price`, `experience` (NULL = N/A), anotador, marca, nota, segundos |
| `label_history` | cada guardado, incluidas las ediciones |
| `skips`, `claims` | saltadas por anotador y reservas activas |
| `suggestions` | sugerencia de la IA por reseña: mismos 5 puntajes, justificaciones (JSON), modelo y hash del prompt |

`labels.db` no se versiona: hagan backup (o exporten) seguido.
