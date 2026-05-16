# Multiplayer Infrastructure — Change Log & Rollback Guide

**Date:** 2026-05-15  
**Purpose:** Document every change made to the Lightsail server and the bolo repo
during M1 infrastructure setup, so the Matrix messaging service can be fully
restored if anything breaks.

---

## What Was Discovered (Read-Only Reconnaissance)

Before making any changes, the following was read from the server:

| Item | Value |
|---|---|
| Server IP | `100.50.52.68` |
| Matrix nginx container | `matrix-nginx` (image: `nginx:alpine`) |
| Synapse container | `synapse` (image: `matrixdotorg/synapse:latest`) |
| Postgres container | `synapse-postgres` (image: `postgres:16`) |
| Docker network | `matrix_matrix-net` |
| Matrix compose directory | `/opt/matrix/` |
| nginx config path (host) | `/opt/matrix/nginx/nginx.conf` |
| Certbot certs path (host) | `/opt/matrix/certbot/conf/` (→ `/etc/letsencrypt` inside containers) |
| Certbot webroot (host) | `/opt/matrix/certbot/www/` (→ `/var/www/certbot` inside containers) |
| Ports bound | 80 (TCP), 443 (TCP), 8448 (TCP) |

---

## Changes on the Lightsail Server

### nginx config — `/opt/matrix/nginx/nginx.conf`

**Status:** A partial overwrite was attempted via SSH during setup but SSH timed out
before the nginx reload could be confirmed. **Check the current file content before
assuming the state is known:**

```bash
cat /opt/matrix/nginx/nginx.conf
```

If the file no longer matches the original below, restore it immediately (see
Rollback section).

#### Original content (Matrix-only, before any bolo changes)

```nginx
events {}

http {
  # Redirect HTTP to HTTPS
  server {
    listen 80;
    server_name matrix.alisted.app;

    location /.well-known/acme-challenge/ {
      root /var/www/certbot;
    }

    location / {
      return 301 https://$host$request_uri;
    }
  }

  # HTTPS — Matrix client-server API
  server {
    listen 443 ssl;
    server_name matrix.alisted.app;

    ssl_certificate /etc/letsencrypt/live/matrix.alisted.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matrix.alisted.app/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 50M;

# Block Synapse admin API from public internet
    location /_synapse/admin/ {
        allow 127.0.0.1;
        deny all;
    }

    # Block federation API from public internet
    location /_matrix/federation/ {
        allow 127.0.0.1;
        deny all;
    }

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

# Matrix federation port (8448) — needed for .well-known discovery even with federation disabled
stream {
  server {
    listen 8448 ssl;
    ssl_certificate /etc/letsencrypt/live/matrix.alisted.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matrix.alisted.app/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    proxy_pass synapse:8008;
  }
}
```

#### Intended final content (Matrix + bolo, after setup.sh completes)

See `deploy/nginx-bolo-final.conf` in this repo. The matrix block is preserved
verbatim; only a new HTTP redirect block and a new HTTPS proxy block for
`bolo.alisted.app` are added.

---

### Certbot — new cert for `bolo.alisted.app`

`setup.sh` runs certbot to issue a cert for `bolo.alisted.app`. This:
- Writes files under `/opt/matrix/certbot/conf/live/bolo.alisted.app/`
- Writes files under `/opt/matrix/certbot/conf/archive/bolo.alisted.app/`
- Adds a renewal config at `/opt/matrix/certbot/conf/renewal/bolo.alisted.app.conf`

This is additive — it does not touch the existing `matrix.alisted.app` cert.

---

### Docker — new `bolo-server` container

`setup.sh` runs `docker compose up -d --build` in the bolo repo directory. This:
- Builds a new image from `server/Dockerfile`
- Starts a container named `bolo-server`
- Attaches it to `matrix_matrix-net` as a **read-only network join** (the container
  cannot modify the network or any Matrix containers; it just shares the network
  namespace so nginx can route to it by name)
- Exposes **no ports** to the host or the internet — all traffic enters via nginx

---

### DNS — `bolo.alisted.app`

An A record was added in Cloudflare pointing `bolo.alisted.app` → `100.50.52.68`
with the **proxy turned off (grey cloud / DNS only)**. The Cloudflare proxy was
intentionally disabled so TLS is handled by the server-side nginx/certbot, matching
how `matrix.alisted.app` is configured.

This record is additive — it does not change the `matrix.alisted.app` record.

---

## Changes in the Bolo Repository

All changes are in the bolo repo only. None touch the Matrix compose files,
synapse config, or postgres data.

| File | Change |
|---|---|
| `docker-compose.yml` | Rewritten — removed Caddy, added `bolo-server` service joined to `matrix_matrix-net` |
| `Caddyfile` | Replaced with a comment noting it is unused |
| `server/src/index.ts` | New — minimal Express + Socket.io server |
| `server/package.json` | New — server-side dependencies |
| `server/tsconfig.json` | New — TypeScript config for server |
| `server/Dockerfile` | New — two-stage Docker build |
| `server/.dockerignore` | New |
| `deploy/nginx-bolo-final.conf` | New — complete nginx config for both services |
| `deploy/setup.sh` | New — one-shot deployment script |
| `deploy/ROLLBACK.md` | New — this file |

---

## How to Fully Roll Back

### 1. Remove the bolo Docker container and image

```bash
cd /opt/bolo   # or wherever the repo is cloned
docker compose down --rmi all
```

This stops and removes the `bolo-server` container and its image. It does **not**
affect any Matrix containers.

### 2. Restore the original nginx config

```bash
cat > /opt/matrix/nginx/nginx.conf << 'EOF'
events {}

http {
  # Redirect HTTP to HTTPS
  server {
    listen 80;
    server_name matrix.alisted.app;

    location /.well-known/acme-challenge/ {
      root /var/www/certbot;
    }

    location / {
      return 301 https://$host$request_uri;
    }
  }

  # HTTPS — Matrix client-server API
  server {
    listen 443 ssl;
    server_name matrix.alisted.app;

    ssl_certificate /etc/letsencrypt/live/matrix.alisted.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matrix.alisted.app/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 50M;

# Block Synapse admin API from public internet
    location /_synapse/admin/ {
        allow 127.0.0.1;
        deny all;
    }

    # Block federation API from public internet
    location /_matrix/federation/ {
        allow 127.0.0.1;
        deny all;
    }

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

# Matrix federation port (8448) — needed for .well-known discovery even with federation disabled
stream {
  server {
    listen 8448 ssl;
    ssl_certificate /etc/letsencrypt/live/matrix.alisted.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/matrix.alisted.app/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    proxy_pass synapse:8008;
  }
}
EOF

# Test the config before reloading
docker exec matrix-nginx nginx -t

# Reload (does not restart; zero downtime)
docker exec matrix-nginx nginx -s reload
```

### 3. Remove the bolo TLS cert (optional cleanup)

```bash
docker run --rm \
  -v /opt/matrix/certbot/conf:/etc/letsencrypt \
  certbot/certbot delete --cert-name bolo.alisted.app
```

This only removes the bolo cert. The `matrix.alisted.app` cert is untouched.

### 4. Remove the DNS record (optional)

In Cloudflare, delete the `bolo` A record. The `matrix` record is separate and
unaffected.

---

## Verification After Rollback

```bash
# Matrix HTTPS still working
curl -I https://matrix.alisted.app

# Matrix federation port still working
curl -I https://matrix.alisted.app:8448

# Confirm no bolo container running
docker ps | grep bolo   # should return nothing
```

---

## What Was NOT Changed

- `/opt/matrix/docker-compose.yml` — untouched
- `/opt/matrix/synapse/` — untouched
- `/opt/matrix/certbot/conf/live/matrix.alisted.app/` — untouched
- `synapse` container — not restarted, not reconfigured
- `synapse-postgres` container — not touched at all
- Lightsail firewall rules — ports 80/443/8448 were already open; no changes made
