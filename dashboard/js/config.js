// Configuración del dashboard. Es lo único que hay que tocar para conectarlo.
import { ENV } from './env.js';

export const CONFIG = {
  appName: 'RestoAnalytics',
  restaurant: 'Dolci B&E',

  // URL base de la API (sin barra final), por ejemplo 'http://127.0.0.1:8000'.
  // Usa GET /reviews/ y POST /reviews/analyze.
  // Vacío = modo demostración: lee data/reviews.json y guarda todo en este navegador.
  // Sale de js/env.js (en Docker, de la variable API_BASE).
  apiBase: ENV.API_BASE,

  // Cada cuántos segundos se piden reseñas nuevas a la API.
  refreshSeconds: 15,

  // Largo de la explicación de cada aspecto (la escribe Qwen), en palabras.
  // Con menos de min no se muestra (queda "—"); con más de max se corta con "…".
  explanationWords: { min: 4, max: 200 },

  sampleData: 'data/reviews.json',
  publicForm: 'opinar.html',
};
