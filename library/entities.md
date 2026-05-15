# ENTITIES
> Part of the Bolo library. See `library/index.md` for the full doc index.

## Overview

Four entity types drive gameplay: Tank (player), Pillbox (stationary enemy/ally), BulletManager (pooled projectiles), and mines (inline struct + sprite). All use Phaser Arcade physics.

---

## Tank (`src/entities/Tank.ts`)

`Phaser.Physics.Arcade.Sprite`, texture `'tank'`. Created once at game start; never re-created on death — position and state are reset in place.

### Stats

| Property | Default | Max | Notes |
|---|---|---|---|
| `health` | 10 | 10 | Pillbox bullet: 1 damage; mine: 3 damage |
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
- Physics body: 22×22 circle, `allowGravity = false`, `setCollideWorldBounds(false)`

### Firing

- `tryFire(delta)` — returns `{x, y, angle}` at barrel tip, or `null` if on cooldown or out of shells
- `FIRE_COOLDOWN_MS = 150`
- `BARREL_LEN = 18px` from sprite center

### Death & respawn

1. `takeDamage(amount)` — returns `true` when health reaches 0
2. On kill: body disabled, sprite hidden, `dead = true`, `respawnTimer = 3000ms`
3. Sea entry: 900ms tween (scale→0, alpha→0, rotate+45°) via `startSinking()`, then kill
4. Respawn: position reset to `starts[0]`, full health and shells, sprite shown

### Forest stealth

When the tank's tile is `DisplayTile.Forest`, GameScene sets `sprite.setAlpha(0.65)` and passes `isHidden=true` to `pillboxes.update()`. This runs every frame while alive — tweens targeting tank alpha will conflict (see Cross-Cutting Rule 4 in `CLAUDE.md`).

### Accessors

- `tileX` / `tileY`: `Math.floor(sprite.x / 32)` — tile grid position
- `x` / `y`: world pixel position
- `angle`: last snapped angle in degrees

---

## Pillbox (`src/entities/Pillbox.ts`)

`Phaser.Physics.Arcade.Sprite`, texture `pill_neutral / pill_friendly / pill_enemy`. Managed by `PillboxManager`.

### Ownership

| Owner | Shoots at player |
|---|---|
| `'neutral'` | Yes |
| `'enemy'` | Yes |
| `'friendly'` | No |

### AI (per frame, skipped when `targetHidden`)

- Range: `SHOOT_RANGE_PX = 320`
- Tracks target, snaps barrel to nearest 22.5°
- Fire cooldown lerps: `COOLDOWN_CRIT (400ms)` at 1 HP → `COOLDOWN_FULL (1500ms)` at full health
- Skipped entirely when `targetHidden = true` (tank in forest)

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

---

## BulletManager (`src/entities/Bullet.ts`)

Object pool of `Phaser.Physics.Arcade.Sprite` (`'bullet'`). Two instances in GameScene: `playerBullets` and `pillboxBullets`.

- `fire(x, y, angle)` — activates a pooled bullet at the given position and angle; speed `600 px/s`
- `kill(sprite)` — deactivates bullet, returns to pool
- `update(delta)` — auto-kills bullets that exceed `MAX_DIST = 500px` from spawn point

### Collision rules

| Source | Target | Effect |
|---|---|---|
| `playerBullets` | `groundLayer` | Apply `WALL_DAMAGE_CHAIN` to tile; kill bullet |
| `playerBullets` | `pillboxes.group` | Damage pillbox; kill bullet |
| `pillboxBullets` | `groundLayer` | Kill bullet (no terrain damage) |
| `pillboxBullets` | `tank.sprite` | Damage tank; kill bullet |
| Any active bullet | Forest tile (frame check) | Forest → Grass; kill bullet |

Forest tiles are not in `COLLISION_TILES`, so they're checked programmatically each frame in `clearForestUnderBullets()` by testing the tile under each active bullet.

---

## Mines (inline in `GameScene.ts`)

```typescript
interface MineMarker { tileX: number; tileY: number; sprite: Phaser.GameObjects.Sprite; }
```

- Placed when builder soldier arrives at target tile (builder action `placeMine`)
- `mine` sprite at depth 1 — visible beneath tank and pillboxes
- Checked each frame in `checkMines()`: if `tank.tileX/tileY` matches → explode
- Explosion: 3 damage to tank, tile → Crater, explosion sprite, remove from `mines[]`

---

## Connects To

- `library/map.md` — `TERRAIN_SPEED` governs tank and builder movement; `setTile` handles mine craters
- `library/builder.md` — soldier dispatched for all build actions including mine placement; pill capture flow

## Update Triggers

- [ ] Tank stats (health cap, shell count, mine count, tree cap) changed
- [ ] Pillbox health, range, or cooldown values changed
- [ ] Bullet speed or max distance changed
- [ ] New entity type added
- [ ] Depth layer assignments changed
- [ ] Collision rules changed
