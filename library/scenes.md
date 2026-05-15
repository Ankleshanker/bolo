# SCENE PIPELINE
> Part of the Bolo library. See `library/index.md` for the full doc index.

## Overview

Two Phaser scenes run in sequence: `BootScene` generates all textures programmatically and immediately hands off to `GameScene`. `GameScene` owns the live game world — map, entities, input, physics, HUD, and all gameplay systems. There is no menu scene.

## Design Intent

All textures are generated at runtime via `Graphics.generateTexture()`. No external image files are loaded for gameplay assets. This keeps the asset pipeline trivial and texture keys stable even while visuals evolve. See `library/decisions.md`.

---

## BootScene (`src/scenes/BootScene.ts`)

**Lifecycle:** `preload()` generates all textures and attempts to load `test.bmap`; `create()` calls `this.scene.start('GameScene')`.

### Tileset texture (`'tileset'`, key `TILESET_KEY`)

One horizontal strip `26 × TILE_SIZE` wide, `TILE_SIZE` tall. Tiles placed left-to-right:

| Index | DisplayTile | Fill color | Notes |
|---|---|---|---|
| 0 | Sea | `0x007888` | Teal base + dark wave dots |
| 1 | Shallow | `0x009999` | Solid teal |
| 2 | Swamp | `0x050a05` | Near-black + scattered green/teal dots |
| 3 | Crater | `0x5a3520` | Dark brown + concentric rings |
| 4 | Road | `0xa08050` | Sandy tan (base only; road variants below) |
| 5 | Forest | `0x0a1a0a` | Dark floor + 5 tree canopies (3 concentric circles each) |
| 6 | Rubble | `0x7a6a50` | Grey-brown + debris squares |
| 7 | Grass | `0x2a4a18` | Olive-green + subtle muted marks |
| 8 | Wall | `0x4a4a4a` | Dark grey + brick pattern lines |
| 9 | DamagedWall | `0x6a6a6a` | Lighter grey (no detail) |
| 10 | Mountain | `0x5a5040` | Top-down rocky peak; NW-lit faces `0x8a7a68`, SE shadow `0x2a1e18`, peak highlight `0xb8a890` |
| 11–26 | Road variants | — | Bitmask 0–15 (N=bit0, E=bit1, S=bit2, W=bit3) |

Road variants 10–25 are drawn by `drawRoadVariant()`: full asphalt base (`0x1c1c1c`), 3px grass shoulders only on sides with no road neighbor, white dashed center-lines toward connected sides, center dot for non-straight shapes.

Tile borders: tiles whose fill == border color (Sea, Shallow, Swamp, Forest, Grass) have invisible borders, preventing a visible tile grid at those terrain types.

### Sprite textures

| Key | Size | Description |
|---|---|---|
| `'tank'` | 32×32 | Grey tank facing north: treads `0x383838`, hull `0x606060`, turret `0x4a4a4a`, barrel `0x2e2e2e` |
| `'soldier'` | 16×16 | Top-down builder figure: helmet, face, torso, legs, rifle |
| `'mine'` | 16×16 | Dark circle with 4 cardinal prongs |
| `'bullet'` | 8×8 | Yellow-white circle |
| `'pill_neutral'` | 32×32 | Grey pillbox |
| `'pill_friendly'` | 32×32 | Green pillbox |
| `'pill_enemy'` | 32×32 | Red pillbox |
| `'pill_cracks'` | 32×32 | Radiating crack lines + center chip; used as alpha-driven damage overlay |
| `'explosion'` | 32×32 | Orange/red concentric rings + yellow center |

### Icon textures

| Key | Size | Used by |
|---|---|---|
| `'icon_shield'` | 16×16 | HP stat bar in HUD |
| `'icon_shell'` | 16×16 | Shells stat bar in HUD |
| `'icon_wood'` | 16×16 | Trees stat bar in HUD |
| `'icon_trees'` | 32×32 | ActionPanel collectTrees button preview |
| `'icon_road'` | 32×32 | ActionPanel buildRoad button preview (E+W road variant) |
| `'icon_wall'` | 32×32 | ActionPanel buildWall button preview |

### Binary asset

`'mapdata'` — attempts `this.load.binary('mapdata', '/maps/test.bmap')`. Load failure logged; GameScene falls back to `generateTestMap()`.

---

## GameScene (`src/scenes/GameScene.ts`)

**Lifecycle:** `create()` initialises all systems; `update(time, delta)` drives the loop.

### Initialisation order (`create()`)

1. `loadMapData()` — parse `.bmap` or call `generateTestMap()`
2. `buildTilemap()` — create Phaser tilemap + `groundLayer`, call `initRoadVisuals()`, `renderMapObjects()`
3. `spawnTank()` — create Tank at `starts[0]`, apply stored team color tint
4. `new BulletManager` × 2 (`playerBullets`, `pillboxBullets`)
5. `new PillboxManager` — one Pillbox per `mapData.pills` entry
6. `new Builder` — with terrain speed callback
7. `setupCollision()` — all physics colliders and overlaps
8. `setupCamera()` — `cameras.main` viewport at `(PANEL_WIDTH, 0, W-PANEL_WIDTH, H)`, follows tank, no bounds
9. `new InputHandler`, `new ActionPanel`, `new SettingsPanel`
10. `buildHUD()` — HUD text + stat bars; stat bars pushed to `hudPanelObjects[]`
11. `setupUiCamera()` — creates `uiCam` at `(0,0,PANEL_WIDTH,H)`; tells `cameras.main` to ignore ActionPanel + gear + stat bars; tells `uiCam` to ignore HUD text + minimap
12. `buildMinimap()` — prerender terrain texture, create `minimapTerrain` sprite + `minimapBlip` graphics
13. `new SoundManager()`, resume on first pointer/key event
14. `setupWorldClick()`

### Update loop order (per frame)

1. If `dead`: `handleRespawn(delta)`, `soundManager.setEngineSpeed(0)`, `updateMinimap()`, `updateHUD()`, return early
2. `getTileUnderTank()` → `tileVal`
3. Sink check: if `tileVal === Sea` and not already sinking → `startSinking()`
4. If not sinking: movement + fire via `Tank.updateTank()` / `Tank.tryFire()`; fire calls `soundManager.playGunshot()`
5. `soundManager.setEngineSpeed(speed)`
6. `tank.sprite.setAlpha(inForest ? 0.65 : 1)` — runs every frame unconditionally
7. `playerBullets.update(delta)`, `pillboxBullets.update(delta)`
8. `clearForestUnderBullets()`
9. `pillboxes.update(delta, tank.x, tank.y, pillboxBullets, inForest, onShot)` — `onShot` calls `soundManager.playPillboxFire()`
10. `builder.update(delta)`
11. `checkPillPickup()`, `checkMines()`, `checkBaseInteraction()`
12. `settingsPanel.update(delta)` — drives name cursor blink
13. `updateMinimap()`, `updateHUD()`

### Two-camera architecture

| Camera | Viewport | Renders |
|---|---|---|
| `cameras.main` | `(PANEL_WIDTH, 0, W-PANEL_WIDTH, H)` | Game world + HUD text + minimap + settings overlay |
| `uiCam` | `(0, 0, PANEL_WIDTH, H)` | ActionPanel buttons + stat bars + gear icon |

`cameras.main` ignores all ActionPanel/SettingsPanel gear/stat bar objects. `uiCam` ignores HUD text and minimap. `scrollFactor(0)` positioning: `canvas_x = camera.viewport.x + object.x`. HUD text sits at `object.x = 6` so it renders at `canvas_x = PANEL_WIDTH + 6 = 106`.

No `setBounds` on either camera. A 16-tile sea border ensures map tiles always fill the viewport even at the playable edge.

### Minimap

- Prerendered 256×256 terrain texture (`'minimap_terrain'`) generated once in `buildMinimap()`: 1px per tile, filled with `MINIMAP_COLORS[displayTile]`
- `minimapTerrain` sprite: scale 0.5 → 128×128 on screen, positioned at `(screenW - 132 - PANEL_WIDTH, screenH - 132)` relative to cameras.main viewport; repositioned on resize
- `minimapBlip` graphics: cleared + redrawn each frame — pillbox dots (green/red/grey), base dots (blue/orange), player white circle, border rect
- Both ignored by `uiCam`

### Settings panel (`src/ui/SettingsPanel.ts`)

- Gear icon (⚙) at bottom of uiCam area; owned by uiCam via `gearObjects[]`
- Click gear → full-screen modal overlay (scrollFactor 0, depth 50–53) rendered by cameras.main
- Modal contains: seed (`CURRENT_SEED`), player name text entry (Phaser keyboard capture, stored in `localStorage['bolo_player_name']`), team color swatches (stored as `localStorage['bolo_team_color']`, applied as tank sprite tint at spawn), Phase 6/7 placeholder sections
- ESC closes the panel; world clicks blocked while open

### HUD layout

- **Top-left of viewport** (cameras.main, depth 30, scrollFactor 0, `object.x=6`): speed + terrain + action state text
- **Left panel (0–100px)** (uiCam): ActionPanel buttons (depth 20–22), stat bars (depth 22–23), gear button (depth 21–22)
- **Stat bars** — start at y=512, stride 26px, bar width 69px:
  - Row 0: HP (`icon_shield`, green `0x44cc44`)
  - Row 1: Shells (`icon_shell`, yellow `0xffdd44`)
  - Row 2: Mines (`mine`, red `0xcc4433`)
  - Row 3: Trees (`icon_wood`, brown `0x7a5230`)
- **Minimap** — bottom-right of game viewport, 128×128, depth 90–91

### Depth layer assignments

| Depth | Contents |
|---|---|
| 0 | Ground layer (tilemap) |
| 1 | Mine sprites |
| 2 | Base markers, start markers |
| 3 | Pillbox sprites |
| 4 | Pill crack overlays, pill pickup icons |
| 5 | Tank sprite |
| 7 | Builder soldier |
| 8 | Explosion sprites |
| 20–23 | ActionPanel UI (uiCam) |
| 21–22 | Settings gear button (uiCam) |
| 22–23 | Stat bars (uiCam) |
| 30 | HUD text (cameras.main) |
| 50–53 | Settings modal overlay (cameras.main) |
| 90–91 | Minimap terrain + blip (cameras.main) |

## Connects To

- `library/map.md` — tile types, terrain data, road bitmask
- `library/entities.md` — Tank, Pillbox, Bullet, mine details
- `library/builder.md` — Builder soldier, ActionPanel actions

## Update Triggers

- [ ] New texture generated in BootScene (add to sprite/icon table)
- [ ] Depth layer assignments changed
- [ ] Update loop order changed
- [ ] Camera or viewport configuration changed
- [ ] HUD layout changed
- [ ] Initialisation order changed
