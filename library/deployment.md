# Deployment

## Client — Cloudflare Workers Assets

**Host:** `bolo-online.com`  
**Tool:** Wrangler (`npx wrangler deploy`)  
**Config:** `wrangler.jsonc` (must be committed — without it, wrangler enters interactive setup mode)

```bash
# From repo root
npm run build
npx wrangler deploy
```

Wrangler reads `wrangler.jsonc`, uploads `dist/` as a SPA (`not_found_handling: single-page-application`), and deploys to the Cloudflare Worker named `bolo-online`.

---

## Server — AWS Lightsail (Docker)

**Host:** `ubuntu@api.bolo-online.com` (also reachable at `100.50.52.68`)  
**SSH key:** `lightsail.pem` — confirmed location: `C:\Users\BenFeingoldThoryn\AppData\Local\Temp\lightsail.pem`  
Also present (gitignored) at repo root as `LightsailDefaultKey-us-east-1.pem` if copied there.  
**Server path:** `/opt/bolo`  
**Health endpoint:** `https://api.bolo-online.com/health`

### Deploy command

```bash
ssh -i "C:\Users\BenFeingoldThoryn\AppData\Local\Temp\lightsail.pem" \
  -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 \
  ubuntu@api.bolo-online.com \
  "cd /opt/bolo && git pull && docker compose up -d --build"
```

### Verify

```bash
ssh -i "C:\Users\BenFeingoldThoryn\AppData\Local\Temp\lightsail.pem" \
  ubuntu@api.bolo-online.com \
  "curl -sf https://api.bolo-online.com/health"
# Expected: {"status":"ok","players":<n>}
```

### Notes

- The server runs as a Docker container named `bolo-server` (see `docker-compose.yml` + `server/Dockerfile`).
- `docker compose up -d --build` rebuilds the image from the updated source and hot-swaps the container with no manual stop/start needed.
- The nginx reverse proxy (`api.bolo-online.com → localhost:3000`) and TLS cert live on the same Lightsail instance and do not need to be touched for routine server deploys.
