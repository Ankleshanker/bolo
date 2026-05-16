#!/bin/bash
# Run this script on the Lightsail instance to complete M1 setup.
# Assumes the bolo repo is cloned somewhere — adjust BOLO_DIR below.
set -e

BOLO_DIR="${1:-/opt/bolo}"   # pass as first arg or default to /opt/bolo
MATRIX_DIR="/opt/matrix"
EMAIL="your@email.com"        # ← replace with your email for Let's Encrypt

echo "=== Step 1: Write nginx config with bolo HTTP block (for cert challenge) ==="
cat > "$MATRIX_DIR/nginx/nginx.conf" << 'NGINX_STAGE1'
events {}

http {
  server {
    listen 80;
    server_name matrix.alisted.app;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
  }

  server {
    listen 80;
    server_name bolo.alisted.app;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
  }

  server {
    listen 443 ssl;
    server_name matrix.alisted.app;
    ssl_certificate /etc/letsencrypt/live/matrix.alisted.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matrix.alisted.app/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    client_max_body_size 50M;
    location /_synapse/admin/ { allow 127.0.0.1; deny all; }
    location /_matrix/federation/ { allow 127.0.0.1; deny all; }
    location / {
      proxy_pass http://synapse:8008;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Host $host;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 600;
    }
  }
}

stream {
  server {
    listen 8448 ssl;
    ssl_certificate /etc/letsencrypt/live/matrix.alisted.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matrix.alisted.app/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    proxy_pass synapse:8008;
  }
}
NGINX_STAGE1

echo "=== Step 2: Test and reload nginx ==="
docker exec matrix-nginx nginx -t
docker exec matrix-nginx nginx -s reload
echo "nginx reloaded OK"

echo "=== Step 3: Issue TLS cert for bolo.alisted.app ==="
docker run --rm \
  -v "$MATRIX_DIR/certbot/conf:/etc/letsencrypt" \
  -v "$MATRIX_DIR/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
  --webroot -w /var/www/certbot \
  -d bolo.alisted.app \
  --email "$EMAIL" \
  --agree-tos --non-interactive
echo "Cert issued OK"

echo "=== Step 4: Write final nginx config (with bolo HTTPS block) ==="
cp "$BOLO_DIR/deploy/nginx-bolo-final.conf" "$MATRIX_DIR/nginx/nginx.conf"

echo "=== Step 5: Test and reload nginx with final config ==="
docker exec matrix-nginx nginx -t
docker exec matrix-nginx nginx -s reload
echo "nginx final config loaded OK"

echo "=== Step 6: Start bolo server ==="
cd "$BOLO_DIR"
docker compose up -d --build
echo "bolo-server started"

echo "=== Step 7: Verify ==="
sleep 3
curl -sf https://bolo.alisted.app/health && echo " — health check PASSED" || echo " — health check FAILED (server may still be starting)"

echo ""
echo "All done. If health check failed, wait 10s and try:"
echo "  curl https://bolo.alisted.app/health"
