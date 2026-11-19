# RestoAnalytics: dashboard y formulario de reseñas

Dos partes, en HTML, CSS y JS sin librerías ni build:

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` (Resumen) | Restaurante | Arriba, **reseña por reseña** (de la más nueva a la más vieja, con flechas) con el puntaje, el fragmento y la explicación de cada aspecto. Al lado, cuántas reseñas hay y **lo principal a arreglar**, con qué hacer. Abajo, el promedio de cada aspecto. |
| `resenas.html` (Reseñas) | Restaurante | No está en el menú: se abre desde el Resumen ("Responder o marcar en Reseñas", "Ver esas reseñas" o una tarjeta de aspecto). Explorador: las reseñas recibidas desde el formulario aparecen primero; búsqueda, filtros y atajos ("Precio crítico", "Sin respuesta", "En seguimiento", "Recibidas del formulario"), el detalle de cada reseña con puntaje, fragmento y explicación por aspecto, y los botones **Responder** y **Marcar para seguimiento**. |
| `opinar.html` | Clientes | Formulario para dejar una reseña: texto obligatorio y nombre opcional. No pide estrellas: el análisis sale solo del texto. En español, portugués e inglés (`opinar.html?lang=pt` o `?lang=en`). |

## Abrirlo

En VS Code, clic derecho en `dashboard/index.html` → **Open with Live Server**. El formulario está en `dashboard/opinar.html` y también se abre desde el menú (**Formulario público**).

## Configuración

Todo lo configurable está en [`js/config.js`](js/config.js):

```js
appName: 'RestoAnalytics',
restaurant: 'Dolci B&E',          // nombre que ven el restaurante y los clientes
apiBase: '',                      // vacío = modo demostración
refreshSeconds: 15,               // cada cuánto se piden reseñas nuevas a la API
```

## Paleta e imágenes

Paleta (variables al principio de `css/app.css`): **Carbón profundo** `#1F1E1C` (barra lateral y paneles oscuros), **Marfil cálido** `#FAF7EF` (fondo), **Cacao** `#6B4432` (títulos y métricas), **Caramelo tostado** `#C7894B` (botones, resaltados y estado activo), **Beige arena** `#E8DDC8` (bordes y separadores) y **Salvia suave** `#8A9B6B` (selección, filtros y valores positivos). Las 5 líneas del gráfico usan tonos de la misma familia, validados para que se distingan también con daltonismo.

| Archivo | Dónde se usa |
|---|---|
| `img/brownie-plato.webp` | Tarjeta oscura "Lo principal a arreglar" del Resumen |
| `img/brownie-rincon.webp` | Abajo en la barra lateral |
| `img/brownie-torre.webp` | Panel oscuro del formulario para clientes |

Son las imágenes originales con el fondo transparente limpio (sin halos), recortadas y convertidas a WebP para que carguen rápido.

## Modo demostración y API

**Sin `apiBase`**, el dashboard lee `data/reviews.json`: las 2.100 reseñas etiquetadas, con su fecha de Yelp y la justificación de la IA. Las respuestas, los seguimientos y las reseñas enviadas desde el formulario se guardan en el navegador (`localStorage`). Si el formulario y el dashboard están abiertos en el mismo navegador, una reseña nueva aparece al instante en el Resumen (**Reseñas recibidas**) y primera en la lista de Reseñas.

**Con `apiBase`** (por ejemplo `'http://127.0.0.1:8000'`), el dashboard usa solo dos rutas:

| Método | Ruta | Recibe | Devuelve |
|---|---|---|---|
| `GET` | `/reviews/` | nada | `{ "dims": [...], "reviews": [Reseña, ...] }`, la más nueva primero |
| `POST` | `/reviews/analyze` | `{ "text": "...", "name": "Ana" \| null }` desde el formulario | `202` y la `Reseña` guardada, todavía con `status: "pending"` |

`POST /reviews/analyze` guarda la reseña y responde enseguida, así el cliente ve el "¡Gracias!" al instante. El análisis (idioma, traducción, kev-4b y Qwen) corre de fondo y tarda unos segundos, o unos minutos si hay que levantar el pod de kev; mientras tanto la reseña aparece "En análisis". El dashboard pide `GET /reviews/` cada `refreshSeconds`; si está abierto en el mismo navegador que el formulario, se actualiza al instante.

Las respuestas y los seguimientos no pasan por la API: quedan guardados en el navegador del restaurante.

Como no hay login, la API tiene que permitir CORS desde cualquier origen (`Access-Control-Allow-Origin: *`), porque Live Server corre en otro puerto.

Cada `Reseña` sigue el formato de `data/reviews.json`. Solo `id` y `text` son obligatorios:

```json
{
  "id": "123",
  "date": "2024-05-31",
  "text": "La pasta estaba buenísima pero esperamos 40 minutos…",
  "lang": "es",
  "source": "Google",
  "restaurant": "Dolci B&E",
  "scores": [5, 2, null, 2, null],
  "quotes": ["The pasta was amazing", "we waited 40 minutes", null, "too expensive for the portion", null],
  "evidence": ["Elogia la pasta.", "Esperó 40 minutos.", null, "Precio alto para la porción.", null],
  "name": "Ana"
}
```

- `dims` define el orden de `scores`: `["food", "wait_time", "service", "price", "experience"]`.
- `scores` va de 1 a 5, o `null` si la reseña no menciona el aspecto (N/A). Lo devuelve kev-4b.
- `quotes` es el fragmento de la reseña que justifica cada puntaje, copiado por el LLM (Qwen). Sale de la reseña traducida, así que está en inglés. Opcional.
- `status` es `pending` (en análisis), `done` o `error`. Con `error`, la reseña se muestra como "No se pudo analizar" con el motivo de `error`. Opcional: sin `status` ni `pending`, la reseña se toma como ya analizada (como en `data/reviews.json`).
- `evidence` es la explicación de cada puntaje que escribe el LLM (Qwen), en español. El dashboard muestra entre 4 y 200 palabras (`explanationWords` en `js/config.js`): si tiene menos muestra "—", si tiene más la corta con "…".

## Cómo se calculan algunas cosas

- **Lo principal a arreglar**: el aspecto del que se queja (puntaje 1–2) el mayor % de reseñas, entre los que tienen al menos 3 quejas.
- **Qué hacer**: una sugerencia fija según las palabras que más se repiten en esas quejas ("filas", "caro", "mal trato"…). Las listas están en `js/metrics.js`. No es un LLM.
- **Citas resaltadas**: en el texto de la reseña (Resumen y detalle de Reseñas) se subraya la cita de cada aspecto; al pasar el mouse dice de qué aspecto es y su puntaje. Si hay una búsqueda activa, se resalta lo buscado en su lugar.
- **Fragmento**: la cita de `quotes`. Si la reseña no la trae, la frase de la reseña que contiene palabras del aspecto (una aproximación por palabras clave).

## Datos de ejemplo

```bash
uv run dashboard/scripts/build_data.py   # regenera data/reviews.json desde reseñas/labels.db
```

## Archivos

```
dashboard/
├── index.html · resenas.html · opinar.html
├── css/app.css
├── js/
│   ├── config.js    configuración
│   ├── api.js       lectura y escritura (API o modo demostración)
│   ├── data.js      normalización de las reseñas
│   ├── metrics.js   métricas, palabras clave, acciones y explicaciones
│   ├── shell.js     menú, filtros y estado de la sincronización
│   ├── review.js    una reseña con su tabla de aspectos (Resumen y Reseñas)
│   ├── ui.js        utilidades e íconos
│   └── resumen.js · resenas.js · opinar.js
├── img/
├── data/reviews.json
└── scripts/build_data.py
```
