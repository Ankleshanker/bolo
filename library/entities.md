# ENTITIES
> Part of the Bolo library. See `library/index.md` for the full doc index.

## Overview

Five entity types drive gameplay: Tank (local player), GhostTank (remote players in MP), Pillbox (stationary enemy/ally), BulletManager (pooled projectiles), and mines (inline struct + sprite). All use Phaser Arcade physics.

---

## Tank (`src/entities/Tank.ts`)

`Phaser.Physics.Arcade.Sprite`, texture `'tank'`. Created once at game start; never re-created on death — position and state are reset in place.

### Stats

| Property | Default | Max | Notes |
|---|---|---|---|
| `health` | 10 | 10 | Pillbox bullet: 1 damage; mine: 3 damage; player bullet (MP): 1 damage |
| `shells` | 200 | 200 | +10 per refuel tick at friendly base (draws from base supply) |
| `mines` | 5 | 20 | +1 per refuel tick at friendly base (draws from base supply) |
| `trees` | 0 | 40 | Harvested from forest tiles |
| `pillsCarried` | 0 | 1 | Collected by driving over a pill pickup |

### Movement

- Left/right arrows: rotate `facing` at 150°/s
- Up arrow: thrust forward; acceleration `700 px/s²`; speed capped at `MAX_SPEED_GRASS × terrainSpeed`
- Down arrow: strong friction (`FRICTION_BRAKE = 0.78`)
- `facing` snaps to nearest 22.5° step (`DIR_SNAP = 360/16`) before applying velocity
- `MAX_SPEED_GRASS = 160 px/s` — multiplied by `TERRAIN_SPEED[tileUnderTank]`
- Physics body: 22×22 rectangle, `allowGravity = false`, `setCollideWorldBounds(false)`

### Firing

- `tryFire(delta)` — returns `{x, y, angle}` at barrel tip, or `null` if on cooldown or out of shells
- `FIRE_COOLDOWN_MS = 150`
- `BARREL_LEN = 18px` from sprite center

### Death & respawn

1. `takeDamage(amount)` — returns `true` when health reaches 0
2. On kill: body disabled, sprite hidden, `dead = true`, `respawnTimer = 3000ms`; in MP: `spectatorMode = true`
3. Sea entry: 900ms tween (scale→0, alpha→0, rotate+45°) via `startSinking()`, then kill
4. Respawn: position reset to `starts[0]`, full health and shells, sprite shown; spectator mode exits

### Forest stealth

When the tank's tile is `DisplayTile.Forest`, GameScene sets `sprite.setAlpha(0.65)` and passes `isHidden=true` to `pillboxes.update()`. This runs every frame while alive — tweens targeting tank alpha will conflict (see Cross-Cutting Rule 4 in `CLAUDE.md`).

### Accessors

- `tileX` / `tileY`: `Math.floor(sprite.x / 32)` — tile grid position
- `x` / `y`: world pixel position
- `angle`: last snapped angle in degrees

---

## GhostTankManager (`src/network/GhostTankManager.ts`)

Manages up to 15 remote player sprites in multiplayer. Each ghost has a sprite, name label, and health bar.

### Physics group

`readonly group: Phaser.Physics.Arcade.Group` — all ghost sprites are added to this group. Used by `setupCollision()` in GameScene to register colliders and overlaps against the group. New ghosts added dynamically are automatically covered without re-registering.

### Ghost physics body

Each ghost body is configured in `addGhost()`:
- `setSize(22, 22)` — matches the local tank body exactly
- `immovable = true` — ghost position is server-authoritative; physics must never displace it
- `enable = false` — disabled on creation; toggled to `true`/`false` alongside `setVisible` in `update()` so dead and forest-hidden ghosts don't participate in collision

### Snapshot interpolation

Each ghost keeps a circular buffer of up to 3 `TankState` snapshots. The render position lags 100ms behind the newest snapshot to allow smooth interpolation between two known states. Linear lerp for x/y, shortest-path lerp for angle.

### Per-frame update

- Interpolated x/y/angle applied each frame
- Alpha: 0.65 if `inForest`, 0.35 if `!connected`, 1.0 otherwise
- Health bar color: green (≥7), yellow (4–6), red (≤3)
- Name label stays offset above sprite

### Key methods

```typescript
addGhost(playerId, name, color, teamIndex)                    // create sprite + label + health bar
removeGhost(playerId)                                         // destroy all objects
updateSnapshot(state: TankState)                             // push new interpolation frame
updateSoldier(playerId, x, y, active)                        // show/move/hide remote builder soldier sprite
setGhosted(playerId, disconnected: boolean)                  // toggle DC visual
getSpriteByPlayerId(playerId): Sprite | undefined             // for spectator camera follow
getPlayerIdBySprite(sprite): string | undefined              // for bullet hit / tank push attribution
getAlivePlayerIds(): string[]                                // for spectator cycling
getAlivePillTargets(): {x,y,hidden?,playerId?}[]              // for host pillbox AI target list
getGhostVelocity(sprite): { vx: number; vy: number }         // approximate velocity from last 2 snapshots
```

---

## Pillbox (`src/entities/Pillbox.ts`)

`Phaser.Physics.Arcade.Sprite`, texture `pill_neutral / pill_friendly / pill_enemy`. Managed by `PillboxManager`.

### Ownership

| Owner | Shoots at player | MP meaning |
|---|---|---|
| `'neutral'` | Yes | Uncaptured |
| `'enemy'` | Yes | Owned by another team |
| `'friendly'` | SP: No. MP: Yes, at enemies | Owned by local player's team |

`owner` is the **display-relative** string used for texture and SP shooting logic.  
`ownerId: string | null` is the **raw playerId** of the current owner (null = neutral). This is what the host uses for team-aware AI filtering in MP and what `PillboxState` stores on the server.

In multiplayer, `owner` is derived from `networkManager.isMyTeam(ownerId)` whenever a `pillboxUpdate` or snapshot is applied.

**Team color tinting:** friendly pills are tinted with the owner's actual team color, not the local player's color. `applyTeamTint(teamColor?: number)` uses the provided hex value; if omitted it falls back to `localStorage` (correct for the local player's own pills in SP). In MP the `MultiplayerBridge` derives the color via `networkManager.getPlayerColor(ownerId)` and passes it to `addPill()` / `capture()` at both `pillboxUpdate` and `applySnapshot` sites.

### AI (per frame)

- Range: `SHOOT_RANGE_PX = 320`
- Accepts `targets: PillTarget[]` (`{ x, y, hidden?, playerId? }`); picks the nearest visible (non-hidden) target in range
- `playerId` on each target is used by `PillboxManager.update()` to filter same-team targets before passing the list to each pill
- Tracks target, snaps barrel to nearest 22.5°
- Fire cooldown lerps: `COOLDOWN_CRIT (400ms)` at 1 HP → `COOLDOWN_FULL (1500ms)` at full health
- Pass `bullets = null` for rotation-only mode (non-host clients in MP)
- **Friendly-pill inertness rule (SP only):** in single-player `PillboxManager.update()` is called without an `isTeammate` callback, so pills with `owner === 'friendly'` are skipped entirely. This is intentional — no valid targets exist in SP.
- **MP host:** `isTeammate = (pillOwnerId, targetPlayerId) => networkManager.sameTeam(...)` is passed; the skip is removed and the per-pill target filter governs who gets shot.
- **MP non-host (rotation-only):** same `isTeammate` callback is passed with `bullets = null`. The full ghost target list is built (local tank + all alive ghosts) so friendly pills visually track enemies between host-broadcast shots. No bullets are fired locally.

### Health & damage

- `MAX_HEALTH = 4`
- `takeDamage()` — crack overlay alpha = `(MAX_HEALTH - health) / (MAX_HEALTH - 1)`: 0 at full health, 1 at 1 HP
- At 0 HP: sprite hidden, body disabled, `alive = false`
- Destroyed pillbox immediately removes from `PillboxManager.pills` and spawns a `pill_neutral` pickup sprite (scale 0.65, alpha 0.9) at the same position in both SP and MP

### Crack overlay

Each Pillbox has a companion `crackSprite` (`'pill_cracks'`, depth 4) co-located with the main sprite. Alpha is driven by damage; reset to 0 on `capture()`.

### Physics body

Immovable circle: radius 12, offset (4, 4). Blocks tank and builder soldier.

### Capture flow

**Single-player:**
1. Tank drives over pill pickup → `tank.pillsCarried = 1`, pickup sprite destroyed immediately
2. Select `buildPillbox` action, click target tile (10 trees + 1 pill required)
3. Builder soldier arrives → `PillboxManager.addPill(tileX, tileY)` creates a new friendly pillbox

**Multiplayer:**
1. Destroyer's client emits `pillPickupSpawned { id, x, y }` to server; no pickup sprite is created locally. The server stores the pickup in the world snapshot and relays `pillPickupSpawned` to **all clients including the destroyer** via `io.to(room)`, which creates the sprite on every client.
2. All clients (including the destroyer) spawn the pickup sprite on receipt of `pillPickupSpawned`
3. Any tank that drives over the pickup tile sends `pillPickupCollected { id }` to the server
4. Server applies a first-come guard: if the pickup still exists, removes it from the snapshot and broadcasts `pillPickupCollected { id, collectorId }` to all clients; if already gone, silently drops
5. All clients destroy the pickup sprite on receipt; the winner (`collectorId`) sets `tank.pillsCarried = 1`
6. Late joiners receive active pickups via `WorldSnapshot.pillPickups[]`

**Multiplayer — placement:**
1. Builder soldier arrives at tile → `addPill(tileX, tileY, networkManager.playerId)` creates the pill locally
2. Placer sends `pillboxUpdate { index, ownerId, health:4, alive:true, tileX, tileY }` — **position fields are required** for remote creation
3. Other clients receive `pillboxUpdate`; if `pills[index]` doesn't exist and position fields are present, they call `addPill()` to create the sprite
4. Late joiners receive the pill via `WorldSnapshot.pillboxStates[]` (which also carries `tileX`/`tileY`) and the same create-if-missing logic runs in `applySnapshot()`

`GameScene.pillPickups` is typed `{ sprite: Phaser.GameObjects.Sprite; id: string }[]`. In SP the `id` is `''`.  
`GameScene.pendingPillCollects: Set<string>` prevents sending duplicate collect events while standing on a tile.

### Key methods

- `addPill(tileX, tileY, ownerId?, teamColor?)` — creates a new friendly pillbox, sets `pill.ownerId`; passes `teamColor` to constructor for tinting
- `capture(newOwner, teamColor?)` — changes owner, texture, and tint; `teamColor` overrides localStorage when the owner is a remote player
- `setFacing(angleDeg)` — rotates the sprite to the given angle
- `fireAt(angleDeg, bullets)` — fires a bullet from the barrel tip at the given angle

### Multiplayer sync

- When a pillbox is damaged/destroyed by the local player: `networkManager.sendPillboxUpdate(idx, ownerId, health, alive)` + `networkManager.sendPillPickupSpawned(id, x, y)`
- When a player **places** a new pillbox: `sendPillboxUpdate(idx, ownerId, 4, true, tileX, tileY)` — tileX/tileY enable remote creation
- When received: `pill.ownerId` is synced; `pill.capture(owner, color)` sets texture and tint; `pill.health = d.health`; `color` comes from `networkManager.getPlayerColor(ownerId)`
- On `setupMultiplayer()`: the **host** pre-broadcasts all map pills as neutral to seed the server snapshot (prevents false domination win)
- **Host** runs full AI each frame and broadcasts `pillboxBulletFired { pillIndex, x, y, angleDeg }` for every shot; non-hosts fire the bullet locally from the broadcast coordinates
- The host's `pillboxes.update()` call passes an `isTeammate` callback so each pill's target list is pre-filtered to exclude same-team players (`networkManager.sameTeam(pill.ownerId, target.playerId)`)
- Pickup collection is server-authoritative via `pillPickupSpawned` / `pillPickupCollected` events (see Capture flow above)

**Known limitation:** If two players simultaneously hold pill pickups and place pillboxes at the same time, their locally-assigned array indices may collide (both = `mapPills.length`). The server's next full snapshot will re-sync state, but the brief window can cause mis-attribution of ownership. This is rare because pickup collection is first-come-first-served.

A second simultaneous-destroy race exists: if two clients destroy the same pill before either `pillboxUpdate {alive:false}` arrives at the other, both may emit `pillPickupSpawned` and the server will store two pickups at the same tile. The first-come `pillPickupCollected` guard prevents double-collection, so the only symptom is a phantom uncollectable pickup sprite. This is rare and accepted as technical debt.

---

## BulletManager (`src/entities/Bullet.ts`)

Object pool of `Phaser.Physics.Arcade.Sprite` (`'bullet'`). Instances in GameScene:
- `playerBullets` — local player shots
- `pillboxBullets` — AI pillbox shots
- `remoteBullets` (MP only) — remote player shots received via `bulletFired` events

- `fire(x, y, angle)` — activates a pooled bullet; speed `600 px/s`
- `kill(sprite)` — deactivates bullet, returns to pool
- `update(delta)` — auto-kills bullets that exceed `MAX_DIST = 500px` from spawn point

### Collision rules

| Source | Target | Effect |
|---|---|---|
| `playerBullets` | `groundLayer` | Apply `WALL_HIT_THRESHOLDS` counter to tile (10 hits to destroy); kill bullet |
| `playerBullets` | `pillboxes.group` | Damage pillbox; kill bullet; broadcast in MP |
| `playerBullets` | `ghostManager.group` (MP) | Kill bullet; `sendBulletHit(targetId, 1)`; play hit sound |
| `pillboxBullets` | `groundLayer` | Kill bullet (no terrain damage) |
| `pillboxBullets` | `tank.sprite` | Damage tank; kill bullet |
| `pillboxBullets` | `ghostManager.group` (MP) | Kill bullet visually (damage self-reported on ghost's client) |
| `remoteBullets` | `groundLayer` | Kill bullet (no terrain damage); no tile effect |
| `tank.sprite` | `ghostManager.group` (MP) | Arcade separation (ghost immovable); velocity-weighted impulse added to local tank; `sendTankPush` sent to ghost client when local tank is faster |
| `playerBullets` / `pillboxBullets` | Forest tile (frame check) | Forest → Grass; kill bullet; broadcast `tileChanged` |
| `remoteBullets` | Forest tile (frame check + kill-zone registry) | Kill bullet; no re-broadcast (shooter already sent `tileChanged`) |

Forest tiles are not in `COLLISION_TILES`, so they're checked programmatically each frame in `clearForestUnderBullets()`.

**Remote-bullet forest kill — race condition:** The shooter broadcasts `tileChanged` the moment their `playerBullet` hits a forest. On the observer's client, that message arrives via the JS event loop (macrotask) and clears the tile *before* the next `update()` frame, so by the time `clearForestUnderBullets()` runs, the terrain is already `Grass` and the terrain check alone would miss the bullet. Two-stage fix:
1. The `tileChanged` handler checks whether the incoming tile *was* `Forest` and, if so, adds `"tileX,tileY"` to `remoteBulletKillZones` (a `Map<string, number>` of tile-key → expiry timestamp, TTL 500 ms).
2. `clearForestUnderBullets()` kills a remote bullet if the terrain is `Forest` (rare — bullet arrived before `tileChanged`) **or** if the bullet's tile key is in `remoteBulletKillZones` (common — `tileChanged` already cleared the tile). The registry entry is consumed on first hit and pruned on expiry.

**MP hit model:** The shooter detects ghost overlap locally and sends `bulletHit` to server. The server relays to all clients. The victim receives `bulletHit { targetId: myPlayerId }` and applies damage locally — calling `tank.takeDamage()` and `sendPlayerKillSelf(shooterId)` if killed. Remote bullets do NOT collide with the local tank (victim self-reports from the server relay).

---

## Mines (inline in `GameScene.ts`)

```typescript
interface MineMarker { tileX: number; tileY: number; sprite: Phaser.GameObjects.Sprite; }
```

- Placed when builder soldier arrives at target tile (builder action `placeMine`)
- `mine` sprite at depth 1 — visible beneath tank and pillboxes
- Checked each frame in `checkMines()`: if `tank.tileX/tileY` matches → explode
- Explosion: 3 damage to tank, tile → Crater, explosion sprite, remove from `mines[]`
- In MP: placement broadcast via `sendMineAdded()`; detonation broadcast via `sendMineDetonated()`

---

## Connects To

- `library/map.md` — `TERRAIN_SPEED` governs tank and builder movement; `setTile` handles mine craters
- `library/builder.md` — soldier dispatched for all build actions including mine placement; pill capture flow
- `library/network.md` — GhostTankManager driven by network events; bullet hit protocol

## Update Triggers

- [ ] Tank stats (health cap, shell count, mine count, tree cap) changed
- [ ] Pillbox health, range, or cooldown values changed
- [ ] Bullet speed or max distance changed
- [ ] New entity type added
- [ ] Depth layer assignments changed
- [ ] Collision rules changed
- [ ] MP bullet hit protocol changed
- [ ] GhostTankManager interpolation or snapshot buffer changed
