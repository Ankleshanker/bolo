# NETWORK LAYER
> Part of the Bolo library. See `library/index.md` for the full doc index.

## Overview

Multiplayer is built on Socket.io (WebSocket transport). The client has a typed singleton `NetworkManager` and a `GhostTankManager` for remote player rendering. The server is a Node.js/Express process managing `LobbyManager` (room registry) and `GameRoom` instances (per-room state machine).

---

## Deployment

| Component | Host | URL |
|---|---|---|
| Client (Phaser SPA) | Cloudflare Workers (Assets) | `https://bolo-online.com` |
| Game server | AWS Lightsail (Docker) | `https://api.bolo-online.com` |
| Legacy server alias | Same Lightsail | `https://bolo.alisted.app` |

**GitHub Actions does NOT deploy** — it is a build-check only. Both components must be deployed manually. See `CLAUDE.md` → Deployment for the full sequence.

### Client deploy (Cloudflare Workers Assets)

```bash
# Always rebuild from HEAD first — dist/ is a build artifact, not version-controlled
npm run build
npx wrangler deploy
```

`wrangler.jsonc` in the repo root contains the Workers config. The `dist/` directory is uploaded as static assets with `not_found_handling: single-page-application`. See `library/decisions.md` → "Cloudflare Workers Assets for client hosting" for why this approach was chosen over GitHub Pages or Cloudflare Pages.

### Server deploy (Lightsail)

```
Host: 100.50.52.68
User: ubuntu
Key:  C:/Users/BenFeingoldThoryn/OneDrive - Lincoln Institute of Land Policy/Desktop/Claude Cowork/Projects/Personal/Bolo/LightsailDefaultKey-us-east-1.pem
```

```bash
ssh -i "C:/Users/BenFeingoldThoryn/OneDrive - Lincoln Institute of Land Policy/Desktop/Claude Cowork/Projects/Personal/Bolo/LightsailDefaultKey-us-east-1.pem" \
  -o StrictHostKeyChecking=no ubuntu@100.50.52.68 \
  "cd /opt/bolo && git pull && sudo docker compose up -d --build > /tmp/bolo-deploy.log 2>&1 && echo 'Deploy started'"
```

Nginx (`matrix-nginx` container on Lightsail) proxies WebSocket connections to the `bolo-server` Docker container on port 3000. TLS certs managed by certbot with Cloudflare DNS-01 challenge.

Verify health after deploy:
```bash
curl https://api.bolo-online.com/health
# Expected: {"status":"ok","players":N}
```

---

## NetworkManager (`src/network/NetworkManager.ts`)

Singleton: `networkManager` / `NetworkManager.instance`.

### Key public state

```typescript
playerId:    string       // assigned by server on room join
roomId:      string
roomCode:    string       // 6-char join code
isHost:      boolean
players:     Map<string, PlayerInfo>
myTeamIndex: number
settings:    RoomSettings | null
latency:     number       // ms, updated every 2s via ping
```

### Connection

`connect()` — creates a Socket.io socket with `transports: ['websocket']`, auto-reconnect enabled. Idempotent — no-op if already connected. `disconnect()` tears down the socket and stops pinging.

Player ID is persisted to `localStorage['bolo_playerId']` on `roomJoined` and re-sent on `rejoinRoom` for the 60s reconnect grace period.

### Lobby emissions

```typescript
listRooms()
createRoom(roomName, settings, name, color)
joinRoom(code, name, color)
rejoinRoom(code, name, color)          // uses stored playerId
leaveRoom()
updateSettings(settings)              // host only
kickPlayer(playerId)                  // host only
startGame()
```

### In-game emissions

```typescript
sendTankState(state)                          // volatile, 20 Hz
sendBulletFired(x, y, angleDeg)
sendBulletHit(targetId, damage)
sendPlayerKillSelf(killerId)                 // victim reports own death
sendTileChanged(tileX, tileY, tile)
sendPillboxUpdate(idx, ownerId, health, alive)
sendBaseUpdate(idx, ownerId)
sendMineAdded(tileX, tileY)
sendMineDetonated(tileX, tileY)
sendBoatAdded(tileX, tileY)
sendSoldierState(x, y, active)               // volatile, 20 Hz — builder position sync
sendPillboxBulletFired(pillIndex, x, y, ang) // host only — relayed to non-hosts
sendPillboxFire(pillIndex, angleDeg)         // host only — relayed to non-hosts
sendRequestSnapshot()                        // called once at end of setupMultiplayer()
```

### Event subscription

```typescript
networkManager.on('roomJoined', callback)
networkManager.off('roomJoined', callback)
```

`on/off` accept any key from `NetEvents` map — fully typed. All server events are forwarded to subscribers. `roomJoined`, `playerJoined`, `playerLeft`, `playerGhosted`, `playerReconnected`, `playerRemoved`, `settingsUpdated`, `hostChanged` are intercepted first to update internal state, then forwarded.

---

## Server Architecture

### `server/src/index.ts` — Express + Socket.io entrypoint

CORS defaults to `https://bolo-online.com` in production, `*` in dev. All socket event handlers registered here. Key patterns:

- `setupRoom(room)` — sets `room.onPlayerExpired` callback once (called from createRoom and joinRoom)
- `_handleLeave(socketId, immediate)` — `immediate=true` for explicit leave/kick (hard remove), `immediate=false` for disconnect (starts 60s grace)

### `server/src/LobbyManager.ts`

- Tracks all rooms by `roomId`
- `socketToRoom` map for O(1) lookup on disconnect
- Generates 6-char alphanumeric room codes
- `listPublicRooms()` — returns rooms in LOBBY or PLAYING state

### `server/src/GameRoom.ts` — room state machine

States: `LOBBY → PLAYING → ENDED`

#### Player management

- `addPlayer(socketId, playerId, name, color)` — assigns team index (FFA: sequential; 2team: n%2; 4team: n%4)
- `removePlayer(playerId)` — marks disconnected, starts 60s `setTimeout`; fires `onPlayerExpired` on expiry
- `reconnectPlayer(socketId, playerId, name, color)` — clears grace timer, restores connected state
- `expirePlayer(playerId)` — hard remove; neutralises owned pillboxes/bases; migrates host if needed; returns new host id or null

#### Game lifecycle

- `startGame(io, roomId)` — transitions to PLAYING, broadcasts `gameStart`, starts 1s tick interval
- `tick(io, roomId)` — decrements timer, emits `timeUpdate`, calls `checkWinCondition()`
- `endGame(io, roomId, payload)` — public entry point; transitions to ENDED, stops tick, broadcasts `gameOver`

#### Win conditions

- **Domination**: all objectives in server snapshot must have the same non-null owner. The host pre-seeds all pillboxes/bases as neutral on game start — without this, an empty snapshot with one owned objective would falsely trigger a win.
- **Deathmatch**: last player with `tankState.alive === true` (or timer expiry → most kills)
- **Timer + objectives**: timer expires → most pillboxes + bases owned wins

#### World snapshot

`getSnapshot(): S2C_StateSnapshot` — used for late joiners. Contains:
- `terrainDiffs[]` — every tile mutated since game start; deduplicated by `(tileX, tileY)` — a later mutation to the same tile overwrites the earlier entry
- `pillboxStates[]` — all known pill states (index, owner, health, alive)
- `baseStates[]` — all known base states (index, owner)
- `mines[]` — all active mines; entries removed on `mineDetonated`
- `boats[]` — all placed boats; entries pruned when their tile is overwritten via `updateTileChanged()` (a tile mutation means the boat is gone)
- `tankStates[]` — last known tank state per player
- `timeElapsed` — ms since game start

**Late-joiner snapshot request:** The server sends `stateSnapshot` immediately after `gameStart` for rooms already in PLAYING state. However, `scene.start()` in Phaser queues the new scene for the next animation frame — `setupMultiplayer()` hasn't registered its event handlers yet when the snapshot arrives, so it is silently dropped. To compensate, `setupMultiplayer()` calls `sendRequestSnapshot()` at the end, after all handlers are wired. The server responds with a fresh `stateSnapshot` on demand.

---

## Event Protocol

### C2S (client → server)

| Event | Payload | Notes |
|---|---|---|
| `listRooms` | — | Server responds with `roomList` |
| `createRoom` | `{ roomName, settings, name, color }` | |
| `joinRoom` | `{ code, name, color }` | Late joiners receive `gameStart` + `stateSnapshot` if PLAYING |
| `rejoinRoom` | `{ code, playerId, name, color }` | Uses stored playerId for grace reconnect |
| `leaveRoom` | — | Immediate hard remove |
| `updateSettings` | `{ settings }` | Host only |
| `kickPlayer` | `{ playerId }` | Host only |
| `startGame` | — | Host only |
| `tankState` | `TankState` | Volatile; relayed to all others in room |
| `bulletFired` | `{ x, y, angleDeg, timestamp }` | Relayed to all others |
| `bulletHit` | `{ targetId, damage, shooterId }` | Relayed to target only |
| `playerKill` | `{ victimId, killerId? }` | Shooter omits killerId; victim sets both |
| `tileChanged` | `{ tileX, tileY, displayTile }` | Relayed + stored in snapshot |
| `pillboxUpdate` | `{ index, ownerId, health, alive }` | Relayed + stored in snapshot |
| `baseUpdate` | `{ index, ownerId }` | Relayed + stored in snapshot |
| `mineAdded` | `{ tileX, tileY, ownerPlayerId }` | Relayed + stored in snapshot |
| `mineDetonated` | `{ tileX, tileY }` | Relayed + snapshot mine removed |
| `boatAdded` | `{ tileX, tileY }` | Relayed + stored in snapshot |
| `pillboxBulletFired` | `{ pillIndex, x, y, angleDeg }` | Host only; server relays to all other clients |
| `pillboxFire` | `{ pillIndex, angleDeg }` | Host only; server relays to all other clients |
| `soldierState` | `{ x, y, active }` | Volatile; server relays with `playerId` appended |
| `requestSnapshot` | — | Any client; server responds with `stateSnapshot` |
| `ping` | callback | Server acks; client measures round-trip |

### S2C (server → client)

| Event | Payload | Notes |
|---|---|---|
| `roomList` | `{ rooms: RoomSummary[] }` | |
| `roomJoined` | `S2C_RoomJoined` | Full room state: playerId, code, isHost, players[], settings |
| `playerJoined` | `{ player: PlayerInfo }` | |
| `playerLeft` | `{ playerId }` | Immediate remove (leaveRoom/kick) |
| `playerGhosted` | `{ playerId }` | Disconnect grace started |
| `playerReconnected` | `{ playerId, player }` | Grace cleared |
| `playerRemoved` | `{ playerId }` | Grace expired |
| `settingsUpdated` | `{ settings }` | |
| `hostChanged` | `{ newHostPlayerId }` | |
| `gameStart` | `S2C_GameStart` | mapType, seed, mapData?, teamAssignments, players, settings, serverStartTime |
| `stateSnapshot` | `S2C_StateSnapshot` | Sent to late joiners alongside `gameStart` |
| `tankState` | `TankState` | 20 Hz relay; volatile |
| `bulletFired` | `{ playerId, x, y, angleDeg, timestamp }` | |
| `bulletHit` | `{ targetId, damage, shooterId }` | |
| `tileChanged` | `{ playerId, tileX, tileY, displayTile }` | |
| `pillboxUpdate` | `{ index, ownerId, health, alive }` | |
| `baseUpdate` | `{ index, ownerId }` | |
| `mineAdded` | `{ tileX, tileY, ownerPlayerId }` | |
| `mineDetonated` | `{ tileX, tileY }` | |
| `boatAdded` | `{ tileX, tileY }` | |
| `timeUpdate` | `{ remaining: number }` | ms remaining; drives client timer in MP |
| `pillboxBulletFired` | `{ pillIndex, x, y, angleDeg }` | Relayed from host to all other clients |
| `pillboxFire` | `{ pillIndex, angleDeg }` | Relayed from host to all other clients |
| `soldierState` | `{ playerId, x, y, active }` | Builder position; relayed volatile from server |
| `playerKill` | `{ killerId, killerName, victimId, victimName }` | Broadcast to room |
| `gameOver` | `S2C_GameOver` | reason, winnerId, winnerName, scores[] |
| `kicked` | — | Sent to kicked player before removal |
| `error` | `{ message }` | |

---

## RoomSettings

```typescript
interface RoomSettings {
  mapType:      'procedural' | 'bmap';
  mapName:      string;
  mapData?:     string;          // base64-encoded .bmap (custom uploaded maps)
  seed:         number;
  teamMode:     'ffa' | '2team' | '4team';
  winCondition: 'timer' | 'domination' | 'deathmatch';
  friendlyFire: boolean;
  maxPlayers:   number;
  isPublic:     boolean;
  timerSeconds: number;          // default 600 (10 min)
}
```

`mapData` is only populated when the host uploads a custom .bmap in the lobby. It is stored in room settings and broadcast to all clients via `gameStart.settings.mapData`. Clients decode from base64 at map load time.

---

## Host-Authoritative Pillbox AI

In multiplayer, only the host runs the full pillbox AI each frame:

1. Host builds a `PillTarget[]` list: local tank (if alive) + all alive ghost positions (`ghostManager.getAlivePillTargets()`).
2. `pillboxes.update()` picks the nearest visible target per pill, fires into `pillboxBullets`, calls `onShot(pillIndex, x, y, angleDeg)`.
3. Host emits `pillboxBulletFired { pillIndex, x, y, angleDeg }` and `pillboxFire { pillIndex, angleDeg }` to the server.
4. Server relays both to **all other clients** (host excluded — it already fired locally).
5. Non-host clients receive `pillboxFire`, call `pill.setFacing(angleDeg)` and `pill.fireAt(angleDeg, pillboxBullets)`, and play the sound.
6. The existing `pillboxBullets` vs `tank.sprite` overlap on each machine detects damage locally — no new hit protocol needed.
7. `pillboxBullets` vs `ghostManager.group` overlap (Phase 2) kills the bullet visually when it reaches a ghost sprite on spectator screens.

Non-hosts call `pillboxes.update()` with `bullets = null` — rotation logic runs (approximate visual using local tank target) but no bullet is created.

---

## Kill Attribution

The `playerKill` event supports two modes:

1. **Shooter reports**: `{ victimId }` — sent by the shooter immediately after hitting a target
2. **Victim reports**: `{ victimId: myId, killerId }` — sent by the victim after receiving `bulletHit` and dying

The server distinguishes mode by `data.victimId === socket.playerId` (victim sending) vs not (shooter sending). The victim-reports path is the canonical one for damage — the shooter path is a fallback. Server records kill in `room.recordKill(killerId, victimId)` and broadcasts.

---

## Connects To

- `library/scenes.md` — LobbyScene drives NetworkManager connect/create/join; GameScene calls setupMultiplayer()
- `library/entities.md` — GhostTankManager driven by `tankState` events; bullet hit drives `bulletHit` events

## Update Triggers

- [ ] New socket event added (add to C2S or S2C table)
- [ ] RoomSettings interface changed
- [ ] Win condition logic changed
- [ ] Kill attribution model changed
- [ ] Server deployment topology changed (SSH host, key path, docker compose file)
- [ ] Client hosting changed (wrangler config, Cloudflare account)
- [ ] Grace period duration changed
