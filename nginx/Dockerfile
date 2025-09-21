# Use official nginx image
FROM nginx:stable-alpine

# Install envsubst for dynamic config (if you need ${PORT})
RUN apk add --no-cache gettext

# Copy your custom nginx.conf template
COPY nginx.conf /etc/nginx/nginx.conf.template

# Copy static site files (make sure index.html is inside ./html/)
COPY html /usr/share/nginx/html

# Expose port 80 (Render maps $PORT automatically)
EXPOSE 80

# Replace ${PORT} in nginx.conf.template and start nginx
CMD sh -c "envsubst '\$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && \
           exec nginx -c /etc/nginx/nginx.conf -g 'daemon off;'"
