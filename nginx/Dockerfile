# Use official nginx image
FROM nginx:stable-alpine

RUN apk add --no-cache gettext

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy your config template
COPY nginx.conf /etc/nginx/nginx.conf.template

# Copy static site
COPY html /usr/share/nginx/html

# Expose Render port
EXPOSE 80

# Replace ${PORT} and start nginx
CMD sh -c "envsubst '\$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && exec nginx -g 'daemon off;'"
