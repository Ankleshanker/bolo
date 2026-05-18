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
| `shells` | 200 | 200 | Refilled to 200 at bases |
| `mines` | 5 | 20 | Refilled +5 at bases |
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

`readonly group: Phaser.Physics.Arcade.Group` — all ghost sprites are added to this group. Used by `setupCollision()` in GameScene to register a single overlap against `playerBullets.group`. This means new ghosts added dynamically are automatically covered without re-registering overlaps.

### Snapshot interpolation

Each ghost keeps a circular buffer of up to 3 `TankState` snapshots. The render position lags 100ms behind the newest snapshot to allow smooth interpolation between two known states. Linear lerp for x/y, shortest-path lerp for angle.

### Per-frame update

- Interpolated x/y/angle applied each frame
- Alpha: 0.65 if `inForest`, 0.35 if `!connected`, 1.0 otherwise
- Health bar color: green (≥7), yellow (4–6), red (≤3)
- Name label stays offset above sprite

### Key methods

```typescript
addGhost(playerId, name, color, teamIndex)         // create sprite + label + health bar
removeGhost(playerId)                              // destroy all objects
updateSnapshot(state: TankState)                  // push new interpolation frame
setGhosted(playerId, disconnected: boolean)       // toggle DC visual
getSpriteByPlayerId(playerId): Sprite | undefined  // for spectator camera follow
getPlayerIdBySprite(sprite): string | undefined   // for bullet hit attribution
getAlivePlayerIds(): string[]                     // for spectator cycling
getAlivePillTargets(): {x,y,hidden}[]             // for host pillbox AI target list
```

---

## Pillbox (`src/entities/Pillbox.ts`)

`Phaser.Physics.Arcade.Sprite`, texture `pill_neutral / pill_friendly / pill_enemy`. Managed by `PillboxManager`.

### Ownership

| Owner | Shoots at player | MP meaning |
|---|---|---|
| `'neutral'` | Yes | Uncaptured |
| `'enemy'` | Yes | Owned by another team |
| `'friendly'` | No | Owned by local player's team |

In multiplayer, team-awareness comes from `networkManager.isMyTeam(ownerId)` — the server broadcasts owner by `playerId`.

### AI (per frame)

- Range: `SHOOT_RANGE_PX = 320`
- Accepts `targets: PillTarget[]`; picks the nearest visible (non-hidden) target in range
- Tracks target, snaps barrel to nearest 22.5°
- Fire cooldown lerps: `COOLDOWN_CRIT (400ms)` at 1 HP → `COOLDOWN_FULL (1500ms)` at full health
- Pass `bullets = null` for rotation-only mode (non-host clients in MP)

### Health & damage

- `MAX_HEALTH = 4`
- `takeDamage()` — crack overlay alpha = `(MAX_HEALTH - health) / (MAX_HEALTH - 1)`: 0 at full health, 1 at 1 HP
- At 0 HP: sprite hidden, body disabled, `alive = false`
- Destroyed pillbox immediately removes from `PillboxManager.pills`, spawns a `pill_neutral` pickup sprite (scale 0.65, alpha 0.9) at the same position

### Crack overlay

Each Pillbox has a companion `crackSprite` (`'pill_cracks'`, depth 4) co-located with the main sprite. Alpha is driven by damage; reset to 0 on `capture()`.

### Physics body

Immovable circle: radius 12, offset (4, 4). Blocks tank and builder soldier.

### Capture flow

1. Tank drives over pill pickup → `tank.pillsCarried = 1`, pickup destroyed
2. Select `buildPillbox` action, click target tile (10 trees + 1 pill required)
3. Builder soldier arrives → `PillboxManager.addPill(tileX, tileY)` creates a new friendly pillbox

### Multiplayer sync

- When a pillbox is damaged/destroyed by the local player: `networkManager.sendPillboxUpdate(idx, ownerId, health, alive)`
- When received: `pill.capture(owner)` sets texture + stops shooting; `pill.health = d.health`
- On `setupMultiplayer()`: the **host** pre-broadcasts all pills as neutral to seed the server snapshot (prevents false domination win)

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
| `playerBullets` | `groundLayer` | Apply `WALL_DAMAGE_CHAIN` to tile; kill bullet |
| `playerBullets` | `pillboxes.group` | Damage pillbox; kill bullet; broadcast in MP |
| `playerBullets` | `ghostManager.group` (MP) | Kill bullet; `sendBulletHit(targetId, 1)`; play hit sound |
| `pillboxBullets` | `groundLayer` | Kill bullet (no terrain damage) |
| `pillboxBullets` | `tank.sprite` | Damage tank; kill bullet |
| `remoteBullets` | `groundLayer` | Kill bullet (no terrain damage); no tile effect |
| Any active bullet | Forest tile (frame check) | Forest → Grass; kill bullet |

Forest tiles are not in `COLLISION_TILES`, so they're checked programmatically each frame in `clearForestUnderBullets()`.

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
