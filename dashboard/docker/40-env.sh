#!/bin/sh
# Runs on container start (nginx's /docker-entrypoint.d): writes js/env.js from env vars,
# so the same image works with any API URL.
set -eu
cat > /usr/share/nginx/html/js/env.js <<JS
export const ENV = {
  API_BASE: '${API_BASE:-}',
  PUBLIC_URL: '${PUBLIC_URL:-}',
};
JS
echo "env.js: API_BASE='${API_BASE:-}' PUBLIC_URL='${PUBLIC_URL:-}'"
