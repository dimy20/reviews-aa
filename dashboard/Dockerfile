# Dashboard image: static HTML/CSS/JS served by nginx. Build context is dashboard/.
FROM nginx:1.27-alpine

COPY index.html resenas.html opinar.html /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY img/ /usr/share/nginx/html/img/
COPY data/ /usr/share/nginx/html/data/

# nginx runs every script in /docker-entrypoint.d before starting.
COPY --chmod=755 docker/40-env.sh /docker-entrypoint.d/40-env.sh

EXPOSE 80
