FROM nginx:stable-alpine


RUN apk add --no-cache gettext


COPY nginx.conf /etc/nginx/nginx.conf.template

COPY html /usr/share/nginx/html


EXPOSE 80

CMD sh -c "envsubst '\$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && \
           exec nginx -c /etc/nginx/nginx.conf -g 'daemon off;'"
