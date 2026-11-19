# RestoAnalytics: dashboard y formulario de reseñas

Dos partes, en HTML, CSS y JS sin librerías ni build:

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` (Resumen) | Restaurante | Arriba, **reseña por reseña** (de la más nueva a la más vieja, con flechas) con el puntaje, el fragmento y la explicación de cada aspecto. Al lado, cuántas reseñas hay con su promedio de estrellas y **lo principal a arreglar**, con qué hacer. Abajo, el promedio de cada aspecto. |
| `resenas.html` (Reseñas) | Restaurante | No está en el menú: se abre desde el Resumen ("Responder o marcar en Reseñas", "Ver esas reseñas" o una tarjeta de aspecto). Explorador: las reseñas recibidas desde el formulario aparecen primero; búsqueda, filtros y atajos ("Quejas en 4–5 ★", "Precio crítico", "Sin respuesta", "En seguimiento", "Recibidas del formulario"), el detalle de cada reseña con puntaje, fragmento y explicación por aspecto, y los botones **Responder** y **Marcar para seguimiento**. |
| `opinar.html` | Clientes | Formulario para dejar una reseña: texto obligatorio, estrellas opcionales y nombre opcional. En español, portugués e inglés (`opinar.html?lang=pt` o `?lang=en`). |

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

Paleta (variables al principio de `css/app.css`): **Carbón profundo** `#1F1E1C` (barra lateral y paneles oscuros), **Marfil cálido** `#FAF7EF` (fondo), **Cacao** `#6B4432` (títulos y métricas), **Caramelo tostado** `#C7894B` (botones, estrellas y estado activo), **Beige arena** `#E8DDC8` (bordes y separadores) y **Salvia suave** `#8A9B6B` (selección, filtros y valores positivos). Las 5 líneas del gráfico usan tonos de la misma familia, validados para que se distingan también con daltonismo.

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
| `POST` | `/reviews/analyze` | `{ "text": "...", "rating": 4 \| null, "name": "Ana" \| null }` desde el formulario | la `Reseña` ya analizada |

`POST /reviews/analyze` detecta el idioma, traduce si hace falta, corre kev-4b y Qwen, guarda la reseña y recién ahí responde. El cliente ve "Enviando…" mientras tanto y nunca ve el resultado. El dashboard pide `GET /reviews/` cada `refreshSeconds`; si está abierto en el mismo navegador que el formulario, se actualiza al instante.

Las respuestas y los seguimientos no pasan por la API: quedan guardados en el navegador del restaurante.

Como no hay login, la API tiene que permitir CORS desde cualquier origen (`Access-Control-Allow-Origin: *`), porque Live Server corre en otro puerto.

Cada `Reseña` sigue el formato de `data/reviews.json`. Solo `id` y `text` son obligatorios:

```json
{
  "id": "123",
  "date": "2024-05-31",
  "text": "La pasta estaba buenísima pero esperamos 40 minutos…",
  "lang": "es",
  "rating": 3,
  "source": "Google",
  "restaurant": "Dolci B&E",
  "scores": [5, 2, null, 2, null],
  "evidence": ["Elogia la pasta.", "Esperó 40 minutos.", null, "Precio alto para la porción.", null],
  "name": "Ana"
}
```

- `dims` define el orden de `scores`: `["food", "wait_time", "service", "price", "experience"]`.
- `scores` va de 1 a 5, o `null` si la reseña no menciona el aspecto (N/A). Lo devuelve kev-4b.
- `evidence` es la explicación de cada puntaje que escribe el LLM (Qwen).

## Cómo se calculan algunas cosas

- **Lo principal a arreglar**: el aspecto con más peso en las quejas, es decir, el % de reseñas que se quejan de él multiplicado por cuántas estrellas pierde la reseña cuando ese aspecto falla.
- **Qué hacer**: una sugerencia fija según las palabras que más se repiten en esas quejas ("filas", "caro", "mal trato"…). Las listas están en `js/metrics.js`. No es un LLM.
- **Fragmento**: la frase de la reseña que contiene palabras del aspecto. Es una aproximación por palabras clave, no lo que citó el modelo.

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
