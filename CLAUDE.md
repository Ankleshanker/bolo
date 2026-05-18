# Bolo

A browser-based clone of the 1987/1993 classic Bolo. 2D tile-based tank combat on a 256×256 tile map. Fullscreen responsive canvas. Phases 1–5 (full single-player loop) plus Phase 6 (multiplayer) and major Phase 7 features are complete and deployed.

**Live:** [bolo-online.com](https://bolo-online.com) (client) · [api.bolo-online.com](https://api.bolo-online.com) (server)

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Game engine | Phaser | 4.1.0 |
| Language | TypeScript | 6.0.2 |
| Bundler / dev server | Vite | 8.0.12 |
| Multiplayer | Socket.io | — |
| Client hosting | Cloudflare Workers Assets | — |
| Server hosting | AWS Lightsail (Docker + nginx) | — |

## Roadmap

- [x] Phase 1 — Scaffold: scene pipeline, tilemap renders, tank spawns, camera follows
- [x] Phase 2 — Tank movement: arcade physics, terrain speed modifiers, 16-direction rotation snap
- [x] Phase 3 — Collision: tank vs walls/pillboxes, bullets vs terrain/pillboxes, sea sink animation
- [x] Phase 4 — Combat: bullets, pillbox AI, health, capture, crack overlay, pill pickups
- [x] Phase 5 — Builder & bases: tree harvest, road/wall/pillbox placement, mines, resupply, base capture
- [x] Phase 6 — Multiplayer: lobby, rooms, ghost tanks, bullet sync, world state sync, win conditions, spectator, disconnect grace, kill feed
- [~] Phase 7 — Polish: minimap ✓, sound ✓, base capture ✓, organic map generator ✓, settings UI ✓, map file upload ✓; pixel art pass remaining

## Deployment

There is **no automatic deployment on push**. GitHub Actions runs a build check only. Both components must be deployed manually after committing.

### Full deploy sequence

```bash
# 1. Build the client from the current working tree (always rebuild — dist/ is not auto-updated)
npm run build

# 2. Push client to Cloudflare Workers Assets
npx wrangler deploy

# 3. Deploy server to Lightsail (pulls latest master, rebuilds Docker image)
ssh -i "C:/Users/BenFeingoldThoryn/OneDrive - Lincoln Institute of Land Policy/Desktop/Claude Cowork/Projects/Personal/Bolo/LightsailDefaultKey-us-east-1.pem" \
  -o StrictHostKeyChecking=no ubuntu@100.50.52.68 \
  "cd /opt/bolo && git pull && sudo docker compose up -d --build > /tmp/bolo-deploy.log 2>&1 && echo 'Deploy started'"

# 4. Verify server health
curl https://api.bolo-online.com/health
# Expected: {"status":"ok","players":N}
```

### Critical: always rebuild before deploying

`dist/` is a build artifact — it is NOT updated by `git pull` or by committing code. If any commits were made (by you or a background agent) since the last `npm run build`, the deployed client will be stale. Always run `npm run build` immediately before `npx wrangler deploy`.

### Client-only changes (no server code touched)

```bash
npm run build && npx wrangler deploy
```

### Server-only changes (no client code touched)

```bash
ssh -i "..." ubuntu@100.50.52.68 "cd /opt/bolo && git pull && sudo docker compose up -d --build > /tmp/bolo-deploy.log 2>&1 && echo 'Deploy started'"
```

### Live URLs

| Component | URL |
|---|---|
| Client | https://bolo-online.com |
| Server API / health | https://api.bolo-online.com/health |

---

## Library Maintenance

After completing any task that changes a system, update the relevant library doc before closing. Check that doc's `Update Triggers` section as a checklist. If a new system is introduced, create a new doc and add it to `library/index.md` and the routing table below.

## Library Routing

| System | Doc |
|---|---|
| Scene pipeline (BootScene → LobbyScene → GameScene, texture inventory, lobby UI) | `library/scenes.md` |
| Map system (tile types, terrain data, road bitmask, .bmap loading) | `library/map.md` |
| Entities (Tank, GhostTankManager, Pillbox, Bullet, mines) | `library/entities.md` |
| Builder mechanic (ActionPanel, soldier, build actions, costs, base capture) | `library/builder.md` |
| Network layer (NetworkManager, server, event protocol, room settings, win conditions) | `library/network.md` |
| Architectural decisions | `library/decisions.md` |

## Cross-Cutting Rules

1. **`mapData.terrain` stores display tile indices, not raw Bolo nibble values.**
   Values are `DisplayTile.*` constants (0–10) from `src/map/TileTypes.ts`. The `.bmap` parser converts via `TERRAIN_TO_DISPLAY` before storing. Never compare terrain values against `RawTerrain.*` constants.

2. **Road variant indices (11–26) exist only in the visual tileset layer, never in `mapData.terrain`.**
   Road tiles are stored as `DisplayTile.Road (4)` in the terrain array. Variant indices (bitmask of N/E/S/W neighbors) are written to `groundLayer` by `setTile()` and `initRoadVisuals()`. Don't bypass `setTile()` when mutating roads or neighbor updates will be skipped.

3. **Sea tiles are intentionally absent from `COLLISION_TILES`.**
   Tank entry into sea is detected programmatically each frame and triggers a sink animation + death. Adding sea to `COLLISION_TILES` would block the tank before the animation fires.

4. **The tank sprite alpha is overwritten every frame in `update()`.**
   `setAlpha(inForest ? 0.65 : 1)` runs unconditionally while the tank is alive. Any tween targeting tank alpha will fight this override.

5. **Camera viewport starts at x = PANEL_WIDTH (100px), not x = 0.**
   The left 100px belongs to the ActionPanel. Click coordinates must be converted via `cameras.main.getWorldPoint(pointer.x, pointer.y)`. Never compute world position from raw `pointer.x`.

6. **`_clearDynamic()` in LobbyScene does NOT reset `nameInputFocused` or `codeInputFocused`.**
   These are only reset explicitly in `_setMode()` and the Back button handler. Resetting them in `_clearDynamic()` would kill focus immediately after a pointerdown sets it, since `_renderCreate()` calls `_clearDynamic()` internally.

7. **The host must pre-seed the server snapshot with all objective states on game start.**
   In `setupMultiplayer()`, if `net.isHost`, broadcast all pillboxes and bases as neutral. Without this, the domination win condition sees an empty snapshot and falsely triggers on the first capture.

8. **Remote bullets do NOT collide with the local tank.**
   In MP, the victim takes damage only from the server-relayed `bulletHit` event (not from local physics). Remote bullets collide only with terrain. This prevents double-damage.
