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

### Resupply (friendly base)

When entering a base owned by the local player's team:
- `tank.shells` → 200
- `tank.health` → `min(health + 5, 10)`
- `tank.mines` → `min(mines + 5, 20)`

`lastBaseTileX/Y` tracks the last triggered base to prevent repeated triggers while the tank stands still. Resets to `(-1, -1)` on exit.

### Capture (neutral or enemy base)

Driving over a neutral or enemy base captures it for the local player:
- Base `owner` set to `0x00` (friendly)
- Base marker rectangle recolored to team color
- Sound plays
- In MP: `networkManager.sendBaseUpdate(index, networkManager.playerId)` broadcasts capture

---

## Connects To

- `library/entities.md` — Builder is a physics sprite; interacts with Pillbox group and groundLayer. Mine placement adds to `mines[]`.
- `library/map.md` — `setTile()` executes terrain mutations on arrive; `TERRAIN_SPEED` governs soldier speed
- `library/network.md` — build actions broadcast via NetworkManager in MP

## Update Triggers

- [ ] Build costs changed
- [ ] New build action added to ActionPanel
- [ ] Builder speed, timeout, or arrive distance changed
- [ ] Base resupply amounts or logic changed
- [ ] Base capture broadcast event changed
- [ ] Click handler coordinate logic changed
