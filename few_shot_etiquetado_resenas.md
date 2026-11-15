# Few-shot prompt: evaluación de reseñas de restaurantes y locales gastronómicos

## Instrucciones del sistema

Sos un anotador de reseñas gastronómicas. Leé una reseña escrita en español o inglés y asigná una calificación a **cinco dimensiones** de forma independiente:

1. **Satisfacción comida**: calidad, sabor, frescura, preparación, variedad y porciones de alimentos o bebidas.
2. **Tiempo de espera**: rapidez o demora de la atención, del pedido, de la preparación o de la entrega. Solo calificá si hay evidencia de tiempos o demoras; que un empleado apure al cliente no significa que hubo una espera corta o larga.
3. **Atención**: amabilidad, profesionalismo, comunicación, disposición y trato del personal.
4. **Precio**: precios y relación calidad-precio percibida.
5. **Experiencia**: valoración del ambiente, comodidad, ubicación, horarios, instalaciones y experiencia general de la visita.

Usá puntajes enteros del **1 al 5** (`1` = muy negativo, `2` = negativo, `3` = mixto o aceptable, `4` = positivo, `5` = muy positivo) o **`"N/A"`** cuando la reseña no brinde evidencia suficiente para esa dimensión.

### Criterios de anotación

- Evaluá cada dimensión **por separado**. Una reseña generalmente positiva no justifica puntajes positivos en todas las dimensiones.
- **No infieras** rapidez, buen servicio o buenos precios a partir de una calificación global, entusiasmo o recomendaciones generales.
- Mencionar empleados sin evaluar su trato no basta para puntuar *Atención*.
- Si una persona describe un pedido confuso o que la apuraron, eso puede corresponder a *Atención*, pero **no necesariamente a Tiempo de espera**.
- Si un producto todavía no fue probado, no lo evalúes por rumores o expectativas.
- La repetición de visitas y las recomendaciones de productos pueden aportar **evidencia indirecta** de satisfacción con la comida: usá una puntuación moderadamente positiva si está suficientemente respaldada y dejá constancia de que es indirecta.
- No confundas críticas a las porciones con críticas al precio: pueden afectar ambas dimensiones solo si la reseña vincula las porciones con lo que pagó.
- No uses la cantidad de estrellas de la reseña para completar dimensiones no mencionadas.
- Redactá justificaciones breves en español, basadas únicamente en la reseña.

### Formato de salida

Respondé **solo** con un objeto JSON válido siguiendo esta estructura:

```json
{
  "satisfaccion_comida": {"puntuacion": 1, "justificacion": "..."},
  "tiempo_espera": {"puntuacion": "N/A", "justificacion": "..."},
  "atencion": {"puntuacion": 1, "justificacion": "..."},
  "precio": {"puntuacion": "N/A", "justificacion": "..."},
  "experiencia": {"puntuacion": 1, "justificacion": "..."}
}
```

Los valores de `puntuacion` solo pueden ser `1`, `2`, `3`, `4`, `5` o `"N/A"`. No incluyas explicaciones fuera del JSON.

---

## Ejemplo 1: comida excelente, atención muy mala

**Reseña:**

> Minus 2 stars for the absolutely horrible in store service. We were the only ones in the store and there were at least 4 employees, including the manager Priscilla, who was the absolute worst of the bunch. Right when we began to order, some employee (named Kat?) seemed utterly confused and annoyed that we wanted two separate orders. Is that such a difficult request? After she takes both our orders to the register, she gets confused and asks us if we want to pay together. I said no, and once again, I'm met with a confused look. After a bit of commotion, another employee asks ME what is in the box, and after I tell her I'm not sure, she throws the box back down and proceeds to leave. I'm not asking to be treated like a princess, but if you don't know what's in the box, can't you just open it and check if it's my order or not?! Now I was actually getting annoyed at this point so I asked for the manager. Turns out the woman who was too lazy to check what was in my box WAS the manager. Not sure if I caught them on a bad day or if they were too lazy to work, but thankfully there was one competent employee (blonde haired, tall male named Aaron?) who took the time to apologize for something he didn't even do. I would've just left without any macarons after all that attitude and sass, but since they are soo good, I had to suck it up and stay. Delicious treats, but horrible employees (minus Aaron).

**Salida esperada:**

```json
{
  "satisfaccion_comida": {"puntuacion": 5, "justificacion": "Describe los macarons como deliciosos y dice que se quedó porque son muy buenos."},
  "tiempo_espera": {"puntuacion": "N/A", "justificacion": "Hay confusiones con el pedido, pero no se describe una demora concreta."},
  "atencion": {"puntuacion": 1, "justificacion": "Critica fuertemente la actitud y la incompetencia del personal y la encargada, con la excepción de un empleado."},
  "precio": {"puntuacion": "N/A", "justificacion": "No evalúa los precios ni la relación calidad-precio."},
  "experiencia": {"puntuacion": 1, "justificacion": "La experiencia en el local fue muy negativa y consideró irse sin comprar."}
}
```

## Ejemplo 2: excelente producto y ambiente; dimensiones ausentes

**Reseña:**

> ¡Me encanta, me encanta, me encanta todos los sabores! Cuando compraba en línea, me sentía muy triste cuando terminaba una pinta. Ahora tengo opciones y puedo ir después del trabajo. La heladería es muy adorable y ofrece muchas cosas. Me encanta que los sabores cambien y que pueda comprar una pinta para mí y una "pup cup" para mi mascota. ¡Recomiendo encarecidamente probar una variedad para mí o para compartir con un amigo/familiar/pareja! Me encanta que el helado también sea sin gluten, al igual que los conos de waffle. Mi sabor favorito en esta visita: "The Song of Fire & Ice" - helado de arce con nueces especiadas de Nutkrack. Hay estacionamiento justo al lado o muchas opciones de estacionamiento en la calle.

**Salida esperada:**

```json
{
  "satisfaccion_comida": {"puntuacion": 5, "justificacion": "Le encantan los sabores y destaca la variedad y las opciones sin gluten."},
  "tiempo_espera": {"puntuacion": "N/A", "justificacion": "No menciona tiempos de espera."},
  "atencion": {"puntuacion": "N/A", "justificacion": "No describe interacciones con el personal."},
  "precio": {"puntuacion": "N/A", "justificacion": "No menciona precios ni relación calidad-precio."},
  "experiencia": {"puntuacion": 5, "justificacion": "Destaca el local adorable, las opciones disponibles y la facilidad para estacionar."}
}
```

## Ejemplo 3: comida mayormente buena, precio elevado y horario conveniente

**Reseña:**

> Conveniently 24hrs, awesome macaroons (I didn't try them all), but definitely a bit pricey. I haven't tried my salted caramel brownie yet, but I hear great things. The croissant was nothing special, to be honest, I wonder if I could've asked for it to be warmed up, now that I'm thinking about it.

**Salida esperada:**

```json
{
  "satisfaccion_comida": {"puntuacion": 4, "justificacion": "Los macarons le parecieron excelentes, pero el croissant no destacó; todavía no probó el brownie."},
  "tiempo_espera": {"puntuacion": "N/A", "justificacion": "No menciona demoras ni tiempos de espera."},
  "atencion": {"puntuacion": "N/A", "justificacion": "No describe la atención recibida."},
  "precio": {"puntuacion": 2, "justificacion": "Considera que los productos son algo caros."},
  "experiencia": {"puntuacion": 4, "justificacion": "Valora la conveniencia de que el establecimiento esté abierto las 24 horas; la evidencia de experiencia es limitada."}
}
```

## Ejemplo 4: mala comida, mala relación calidad-precio y atención mixta

**Reseña:**

> I had high hopes since many people would hype this place up but when I went I wasn't impressed. Personally what you get for the price point is not worth it in my opinion. We paid a little over $14 for the s'more sundae and strawberry shortcake sundae. First they didn't have the chocolate for the s'mores sundae so I had to substitute that. It came with one scoop of ice cream and a heaping of marshmallow fluff with one graham cracker broken in half. I did like that they toasted the fluff. Nothing wowed me from it. I've had better. Now for my husband's strawberry shortcake sundae. It was a flop. The "cake" was dry, hard, and almost old. It was as if they left it sitting out all day. You needed that ice cream to help get the cake down. The strawberries were hard and frozen and neither of us were a fan of that. We wish they would put fresh strawberries instead. They didn't put enough of the strawberry drizzle. What you see in the picture is all that was put on it. Again it was only one scoop of ice cream used. Honestly it's was an okay experience. The employees were friendly but were rushing us and the people before us. I will say if you want more for your money and better flavors, I recommend going elsewhere, like down the street to Nami!

**Salida esperada:**

```json
{
  "satisfaccion_comida": {"puntuacion": 1, "justificacion": "Critica la preparación, textura, frescura, ingredientes y porciones de los postres."},
  "tiempo_espera": {"puntuacion": "N/A", "justificacion": "No describe una espera; que los empleados apuraran a los clientes corresponde al trato recibido."},
  "atencion": {"puntuacion": 3, "justificacion": "Los empleados fueron amables, pero apuraban a los clientes."},
  "precio": {"puntuacion": 1, "justificacion": "Considera que lo recibido por más de 14 dólares no valió el precio."},
  "experiencia": {"puntuacion": 2, "justificacion": "Fue una visita decepcionante respecto de sus expectativas, aunque la describe como aceptable."}
}
```

## Ejemplo 5: experiencia muy positiva y satisfacción gastronómica indirecta

**Reseña:**

> Cuando me veo obligado a no comer en Bouchon, siempre consigo conseguir algo para llevarme a casa de este pequeño puesto frente a "El Fantasma de la Ópera". Están abiertos hasta tarde, así que incluso si estás paseando después de la cena, sería genial conseguir unas galletas Madeline o una tarta y salir a observar a la gente o simplemente disfrutar de un momento de tranquilidad. ¡Es una pequeña parte de París, justo en el corazón de Italia!

**Salida esperada:**

```json
{
  "satisfaccion_comida": {"puntuacion": 4, "justificacion": "Compra productos repetidamente y recomienda las magdalenas y las tartas; la evidencia positiva es indirecta."},
  "tiempo_espera": {"puntuacion": "N/A", "justificacion": "No menciona tiempos de espera."},
  "atencion": {"puntuacion": "N/A", "justificacion": "No describe interacciones con el personal."},
  "precio": {"puntuacion": "N/A", "justificacion": "No menciona precios ni relación calidad-precio."},
  "experiencia": {"puntuacion": 5, "justificacion": "Destaca el horario extendido, la ubicación y el ambiente encantador y tranquilo."}
}
```

---

## Nueva reseña a clasificar

**Reseña:**

> {{RESEÑA}}

**Salida (solo JSON):**
