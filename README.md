# Análisis de reseñas de restaurantes por aspecto

Las plataformas de reseñas resumen toda la experiencia en una sola calificación de 1 a 5 estrellas. Eso no dice qué generó la opinión: una misma reseña puede elogiar la comida y quejarse del precio. Este proyecto puntúa por separado cada aspecto que menciona la reseña, para que un restaurante vea qué mejorar.

## Dimensiones

Cada reseña recibe un puntaje de 1 a 5, o N/A si no menciona el aspecto, en:

- Satisfacción con la comida
- Tiempo de espera
- Atención
- Precio
- Experiencia

Ejemplo: *"Primera vez que hago fila en una panadería a las 10 de la noche, pero valió la pena. La tarta de durazno y los macarons estaban increíbles [...] Lo único flojo fue el croissant, que no estaba fresco. Aun así, volvería sin dudas."* (Yelp: 4 estrellas)

| Dimensión | Puntaje | Evidencia |
|---|---|---|
| Satisfacción con la comida | 4/5 | Tarta, macarons y Napoleón buenos; croissant no fresco. |
| Tiempo de espera | 3/5 | Hizo fila a las 22:00, aunque valió la pena. |
| Atención | N/A | No menciona al personal. |
| Precio | N/A | No menciona precios. |
| Experiencia | 5/5 | Volvería sin dudas. |

## Modelo

No entrenamos un modelo desde cero. Usamos [jaredpalmer/kev-4b](https://huggingface.co/jaredpalmer/kev-4b), un modelo de decisión (Qwen3.5-4B-Base + LoRA).

Como funciona? No es un LLM o modelo generativo, pero encaja muy bien con nuestro contexto:

Recibe un texto y un conjunto de preguntas tipadas, y devuelve una distribución de probabilidad calibrada por pregunta en una sola pasada, sin generar texto. 
Cada dimensión es una pregunta sobre la reseña.

Vamos a fine-tunear kev para reviews, seleccionaermos un subconjunto de reviews que etiquetaremos de forma manual para ajustar kev a un corpus de restaurant reviews.

### Paso intermdio para Espanol y Portugues

kev-4b se entrenó solo en ingles, por lo tanto como queremos abacar reviwes en tres idiomas (Ingles, Spanol y Portugues), para inferencia necesitamos un paso previo:
Las reviews en Espanol y Portugues deben ser traducidas a Ingles previamente.

Para esto usamos langdetect para detectar el idioma de entrada y <POR_DECIDIR> para traducir al ingles si se detecta 'es' o 'pt'.

### LLM de explicaciones

Después de kev, un LLM liviano recibe los puntajes y la reseña original, y explica cada puntaje citando los fragmentos de la reseña que lo justifican. Usamos [Qwen/Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B):

- Con 2B de parámetros entra en la misma GPU de 24 GB que kev (que ocupa 14,3 GB).

Si la calidad no alcanza, la alternativa es [Qwen/Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) cuantizado, sin reasoning.

## Datos

- Fuente: Yelp Restaurant Reviews, unas 20 000 reseñas (texto, fecha, rating 1–5). La URL se descarta para proteger a los autores.
- Idiomas: 1/3 se mantiene en inglés, 1/3 se traduce al español y 1/3 al portugués.
- Etiquetas: el dataset solo trae el rating global, así que las etiquetas por dimensión se generan con un LLM más grande.

## Arquitectura

![Arquitectura](docs/architecture.png)

1. **fasttext / langdetect** detecta el idioma de la reseña (~2 ms).
2. **<POR_DECIDIR>* traduce al inglés las reseñas en español o portugués (~200 ms). Las reseñas en inglés se saltan este paso.
3. **kev-4b ajustado** devuelve un puntaje de 1 a 5, o N/A, para cada dimensión (~300 ms).
4. **Un LLM liviano (Qwen3.5-2B)** recibe los puntajes y la reseña original, y con un prompt explica cada puntaje citando los fragmentos de la reseña que lo justifican.
5. **El dashboard de reseñas** muestra los puntajes por dimensión con su evidencia, agregados por restaurante.