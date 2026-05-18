# BUILDER MECHANIC
> Part of the Bolo library. See `library/index.md` for the full doc index.

## Overview

The builder is a soldier unit that runs from the tank to a target tile, executes a build action, then returns. Only one soldier can be out at a time. The ActionPanel provides UI for selecting and triggering actions via mouse click or keyboard hotkeys.

---

## Builder (`src/entities/Builder.ts`)

Velocity-driven `Phaser.Physics.Arcade.Sprite` (`'soldier'`, scale 1.5). Registered with physics so walls and pillboxes naturally block it.

### Constructor

```typescript
new Builder(scene, groundLayer, pillboxGroup, getSpeedAt)
```

- Collides with `groundLayer` (wall tiles block movement)
- Collides with `pillboxGroup` (pillboxes block movement)
- `getSpeedAt(worldX, worldY) => number` — called each frame; returns `TERRAIN_SPEED[tile]`, clamped to `MIN_SPEED_MULT = 0.3` so the soldier never completely stops

### State machine

`'idle' | 'outbound' | 'returning'`

- **Outbound**: moves toward fixed `(targetX, targetY)`. Timer increments each frame. If `OUTBOUND_TIMEOUT_MS = 10000ms` elapses before arrival, abandons task and switches to returning without calling `onArrive`.
- **Returning**: moves toward live tank position, polled each frame via `getReturnPos()`. Tracks tank movement in real time.
- **Arrive** (within `ARRIVE_DIST = 8px`): outbound → call `onArrive()`, switch to returning; returning → `_finish()` (reset to idle).

### Speed

`SOLDIER_BASE_SPEED = 80 px/s × terrainSpeedMultiplier`. Terrain affects the soldier the same way it affects the tank. Sea is passable at minimum speed (0.3×, clamped) — the 10s timeout handles cases where the soldier gets stuck in water.

### API

```typescript
dispatch(toX, toY, getReturnPos, onArrive)  // no-op if isBusy
cancel()                                     // abort and return immediately
update(delta)                                // called every frame by GameScene
get isBusy: boolean
```

---

## ActionPanel (`src/ui/ActionPanel.ts`)

Fixed panel occupying x=0–100px of the canvas (`PANEL_WIDTH = 100`). Five buttons, each 88×90px, stacked vertically.

### Actions

| Key | Hotkey | Cost | Target tile guards | Effect on arrive |
|---|---|---|---|---|
| `collectTrees` | 1 | — | Must be Forest | Forest → Grass, `trees += 4` (capped at 40) |
| `buildRoad` | 2 | 2 trees | Not Sea, not Forest | Tile → Road |
| `buildWall` | 3 | 4 trees | Not Sea, not Forest | Tile → Wall |
| `buildPillbox` | 4 | 10 trees + 1 `pillsCarried` | Not Sea, not Wall, not Forest | Place friendly pillbox at tile |
| `placeMine` | 5 | 1 mine | Not Sea | Spawn mine sprite, add to `mines[]` |

Forest tiles must be cleared with `collectTrees` before any build action can target them.

### Tree cost timing

Tree costs (`buildRoad`, `buildWall`, `buildPillbox`) are **deducted immediately on click**, before the soldier departs. If the soldier fails to arrive (timeout or cancel), resources are not refunded.

---

## World Click Handler (`GameScene.setupWorldClick`)

Fires on `pointerdown` anywhere on canvas:

1. Ignore if `pointer.x < PANEL_WIDTH` (panel area — panel has its own handlers)
2. Ignore if `builder.isBusy` or `dead`
3. Convert pointer to world coords: `cameras.main.getWorldPoint(pointer.x, pointer.y)`
4. Compute `tileX = Math.floor(worldX / TILE_SIZE)`, `tileY` same
5. Bounds-check against `MAP_SIZE`
6. Call `tryBuilderAction(tileX, tileY)`

Actions queue is one deep — if the builder is busy, the click is silently discarded.

---

## Bases

`checkBaseInteraction()` runs each frame in the update loop. When `tank.tileX/tileY` matches a base tile:

### Base states

| `owner` | Color | Meaning |
|---|---|---|
| `0xFF` | White | Neutral — HP=0, drive over to capture |
| `0x00` | Team color | Friendly — refuels tank while parked |
| `0x01` | Red | Enemy — must shoot to HP 0 before capturing |

### HP system

- `BASE_MAX_HEALTH = 4` (matching pillboxes).
- Neutral bases have `baseHealth[i] = 0` and can be captured by driving over them.
- Capturing sets HP to `BASE_MAX_HEALTH` and resets supplies to 0.
- Player bullets overlap an invisible physics sprite per base (`baseGroup`). Hitting an enemy/neutral-owned base decrements `baseHealth[i]`; at 0 → base goes neutral (white).
- Own team's base cannot be damaged by bullets.

### Supply system

Each base tracks `base.shells` (0–90) and `base.mines` (0–20) as runtime float values on `BaseInfo`:
- On capture (or recapture from enemy): both reset to 0.
- While owned (non-neutral): replenish at `90 / (5×60×1000) shells/ms` and `20 / (5×60×1000) mines/ms` — 5 minutes from 0 to full.
- Replenishment runs every frame via `updateBaseSupplies(delta)`.

### Continuous refuel (friendly base)

While tank is parked on a friendly base, `checkBaseInteraction(delta)` accumulates `baseRefuelAccum`. Every `BASE_REFUEL_INTERVAL_MS = 1000 ms`:
- Health: `+1` up to max 10 (no supply cost).
- Shells: give `min(10, floor(base.shells), 200 − tank.shells)` from base supply.
- Mines: give `min(1, floor(base.mines), 20 − tank.mines)` from base supply.
- Plays resupply sound if anything was transferred.

`lastBaseTileX/Y` still tracks current base; `baseRefuelAccum` resets to 0 when the tank leaves.

### Capture (neutral base)

Driving onto a neutral base for the first time (`lastBaseTileX/Y` mismatch):
- `base.owner = 0x00`, supplies = 0, `baseHealth[i] = BASE_MAX_HEALTH`.
- Rect recolored to team color.
- In MP: `networkManager.sendBaseUpdate(index, playerId, BASE_MAX_HEALTH, 0, 0)`.

### Neutralizing (enemy base)

When a player's bullets reduce `baseHealth[i]` to 0:
- `base.owner = 0xFF`, supplies = 0.
- Rect recolored to white.
- In MP: `networkManager.sendBaseUpdate(index, null, 0, 0, 0)`.

---

## Connects To

- `library/entities.md` — Builder is a physics sprite; interacts with Pillbox group and groundLayer. Mine placement adds to `mines[]`.
- `library/map.md` — `setTile()` executes terrain mutations on arrive; `TERRAIN_SPEED` governs soldier speed
- `library/network.md` — build actions broadcast via NetworkManager in MP

## Update Triggers

- [ ] Build costs changed
- [ ] New build action added to ActionPanel
- [ ] Builder speed, timeout, or arrive distance changed
- [ ] Base HP max, supply caps, or refuel tick amounts changed
- [ ] Base resupply timing or accumulator logic changed
- [ ] Base capture/neutralize broadcast event changed
- [ ] Click handler coordinate logic changed
