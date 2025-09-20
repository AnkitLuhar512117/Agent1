FROM nginx:stable-alpine

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf


EXPOSE 10000

CMD ["nginx", "-g", "daemon off;"]
