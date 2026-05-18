# SCENE PIPELINE
> Part of the Bolo library. See `library/index.md` for the full doc index.

## Overview

Three Phaser scenes run in sequence: `BootScene` generates all textures and attempts to load map assets, then hands off to `LobbyScene`. `LobbyScene` handles the main menu, multiplayer lobby, and solo setup. `GameScene` owns the live game world — map, entities, input, physics, HUD, and all gameplay systems.

## Design Intent

All textures are generated at runtime via `Graphics.generateTexture()`. No external image files are loaded for gameplay assets. This keeps the asset pipeline trivial and texture keys stable even while visuals evolve. See `library/decisions.md`.

---

## BootScene (`src/scenes/BootScene.ts`)

**Lifecycle:** `preload()` generates all textures and loads map binaries; `create()` calls `this.scene.start('LobbyScene')`.

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

### Binary assets

- `'mapdata'` — `this.load.binary('mapdata', '/maps/test.bmap')`. Load failure logged; GameScene/LobbyScene fall back gracefully.
- Bundled maps in `public/maps/`: `test.bmap`, `everard-island.bmap`

---

## LobbyScene (`src/scenes/LobbyScene.ts`)

**Lifecycle:** `create()` sets up the UI and registers NetworkManager listeners; `shutdown()` removes them.

The lobby opens on the **Multiplayer** tab by default. All UI is drawn with Phaser primitives (no DOM). Dynamic content is tracked in `dynamicObjs[]` and replaced by `_clearDynamic()` + re-render on state changes.

### Layout

- **Title**: "BOLO" (88px blue) + "ONLINE" (56px red italic), centered as a pair
- **Subtitle**: "CLASSIC TANK COMBAT" (18px, `#6699bb`)
- **Tab bar** at `H * 0.27`: SOLO | MULTIPLAYER — both 140×36px, gap 8px
- **Dynamic area** below tabs: controlled by `mode` (`'solo'|'multi'`) and `view` (`'browse'|'create'|'room'`)

### Solo view (`_renderSolo()`)

Two map-type cards side by side:
- **Procedural card**: seed display + Randomize button; `_setMapMode(true)` on click
- **Map File card**: shows file name if loaded, greyed if not; **📁 Upload .bmap** button always present — triggers `_triggerMapUpload()` which opens a native file picker
- Player name display (read from `localStorage['bolo_player_name']`)
- **▶ START SOLO** button → `_startSolo()` → `scene.start('GameScene', { useProcedural, seed })`

### Multi browse view (`_renderMultiBrowse()`)

- Public room list (up to 5 rows, click to join)
- Refresh button → `networkManager.listRooms()`
- Join-by-code input (6-char, keyboard-driven; `codeInputFocused` flag)
- **＋ CREATE ROOM** button → `view = 'create'`

### Create room view (`_renderCreate()`)

Fields in order:
1. **Room name** text input (`nameInputFocused` flag; typing appends to `roomNameInput`)
2. **Map**: Procedural | Map file buttons. If Map file selected: shows `_triggerMapUpload()` button + filename
3. **Teams**: FFA | 2 Teams | 4 Teams
4. **Win**: Timer+Objectives | Domination | Deathmatch
5. **Friendly Fire**: OFF/ON toggle
6. **Visibility**: Public/Private toggle
7. **Max players**: +/− spinner (2–16, default 8)
8. **Game length**: 5 min | 10 min | 20 min | 30 min buttons (default 10 min)
9. **✓ CREATE** → `_createRoom()` → `networkManager.createRoom(...)`
10. **← Back** → `view = 'browse'`, `nameInputFocused = false`

> **Input focus bug (fixed):** `_clearDynamic()` does NOT reset `nameInputFocused` or `codeInputFocused`. Focus is only reset explicitly in `_setMode()` and the Back button handler. Removing these resets from `_clearDynamic()` was necessary because `_renderCreate()` calls `_clearDynamic()` internally, which was killing focus immediately after the pointerdown handler set it.

### Room lobby view (`_renderRoom()`)

- Room code + share link
- Player list with color dots, "(you)" marker, "(DC)" for disconnected
- Kick buttons (host only, not self)
- Settings summary (team mode, win condition, timer, max players, friendly fire)
- **▶ START GAME** (host only) → `networkManager.startGame()`
- **← Leave** → `networkManager.leaveRoom()`, return to browse

### Map file upload (`_triggerMapUpload()`)

Creates a hidden `<input type="file" accept=".bmap">` element, reads the selected file as `ArrayBuffer`, stores:
- In `this.cache.binary` as `'mapdata'` (for solo play in the current session)
- As base64 in `this.uploadedMapData` (for MP — passed as `settings.mapData` when creating a room)
- Filename in `this.uploadedMapName` (displayed in UI)

### Keyboard handler

`window.addEventListener('keydown', ...)` registered in `create()`, removed in `shutdown()`. Routes to `nameInputFocused` or `codeInputFocused` text input handling, or Enter/Space to start solo.

### Network listeners

Registered once in `create()`, cleaned up in `_cleanupListeners()` (called from `shutdown()` and before scene transition):
`roomList`, `roomJoined`, `playerJoined`, `playerRemoved`, `playerGhosted`, `playerReconnected`, `settingsUpdated`, `hostChanged`, `error`, `gameStart`

`gameStart` fires `scene.start('GameScene', { multiplayerMode: true, gameStart: d })`.

---

## GameScene (`src/scenes/GameScene.ts`)

**Lifecycle:** `init(data)` stores `GameSceneInitData`; `create()` initialises all systems; `update(time, delta)` drives the loop; `shutdown()` removes net handlers.

### Init data

```typescript
interface GameSceneInitData {
  useProcedural?: boolean;    // solo: use procedural map
  seed?: number;              // solo: procedural seed
  multiplayerMode?: boolean;  // true when launched from multiplayer lobby
  gameStart?: S2C_GameStart;  // MP: server game start payload
}
```

### Initialisation order (`create()`)

1. `loadMapData()` — checks `gameStart.settings.mapData` (base64 inline), then Phaser cache `'mapdata'`, then falls back to `generateTestMap(seed)`
2. `baseGroup = physics.add.group()` — **must precede `buildTilemap()`**; `renderMapObjects()` adds hit sprites to this group
3. `buildTilemap()` — create Phaser tilemap + `groundLayer`, call `initRoadVisuals()`, `renderMapObjects()`
4. `spawnTank()` — create Tank at `starts[0]`, apply stored team color tint
5. `new BulletManager` × 2 (`playerBullets`, `pillboxBullets`)
6. `new PillboxManager` — one Pillbox per `mapData.pills` entry
7. `new Builder` — with terrain speed callback
8. If `multiplayerMode`: `new GhostTankManager`, `new BulletManager` (`remoteBullets`)
9. `setupCollision()` — all physics colliders and overlaps (includes ghost overlap if MP)
10. `setupCamera()` — `cameras.main` viewport at `(PANEL_WIDTH, 0, W-PANEL_WIDTH, H)`, follows tank
11. `new InputHandler`, `new ActionPanel`, `new SettingsPanel`
12. `buildHUD()`, `setupUiCamera()`, `buildMinimap()`
13. `new SoundManager()`, resume on first pointer/key event
14. `setupWorldClick()`
15. `buildTimerHUD()`
16. If `multiplayerMode`: `setupMultiplayer()`

### `setupMultiplayer()`

1. Adds all existing players (from `networkManager.players`) as ghost tanks except self
2. If `isHost`: broadcasts all initial pillbox and base states as neutral via `sendPillboxUpdate` / `sendBaseUpdate` — pre-populates server snapshot so domination win condition has full objective count
3. Registers all net event handlers via `_addNetHandler()` (stored in `_netHandlers[]` for cleanup)
4. Calls `networkManager.sendRequestSnapshot()` — requests a fresh `stateSnapshot` now that all handlers are registered. The server sends a snapshot immediately on join but it arrives before `create()` runs and is dropped; this call is the reliable recovery path.

### Update loop order (per frame)

1. If `gameOver`: return immediately
2. SP timer decrement (MP timer driven by `timeUpdate` events from server)
3. Spectator camera update (MP, dead)
4. `chyron.update(delta)` — runs unconditionally so ticker keeps scrolling during spectator/dead
5. If `dead`: `handleRespawn(delta)`, `updateMinimap()`, `updateHUD()`, return early
6. `getTileUnderTank()` → `tileVal`
7. Sea sink check
8. Movement + fire via `Tank.updateTank()` / `Tank.tryFire()`
9. `tank.sprite.setAlpha(inForest ? 0.65 : 1)` — unconditional, every frame
10. `playerBullets.update()`, `pillboxBullets.update()`, `remoteBullets?.update()`
11. `clearForestUnderBullets()`
12. `pillboxes.update()`, `builder.update()`, `ghostManager?.update()`
13. `checkPillPickup()`, `checkMines()`, `checkBaseInteraction()`
14. `settingsPanel.update(delta)`
15. `updateMinimap()`, `updateHUD()`
16. 20 Hz send tick (MP only): accumulator-gated, emits `sendTankState()` and `sendSoldierState(builder.x, builder.y, builder.isBusy)`

### `shutdown()`

Iterates `_netHandlers[]` and calls `networkManager.off()` for each registered callback.

### Two-camera architecture

| Camera | Viewport | Renders |
|---|---|---|
| `cameras.main` | `(PANEL_WIDTH, 0, W-PANEL_WIDTH, H)` | Game world + HUD text + kill feed + chyron + minimap + settings overlay |
| `uiCam` | `(0, 0, PANEL_WIDTH, H)` | ActionPanel buttons + stat bars + gear icon |

`cameras.main` ignores ActionPanel/SettingsPanel gear/stat bar objects. `uiCam` ignores HUD text, minimap, and all chyron objects. `scrollFactor(0)` positioning: `canvas_x = camera.viewport.x + object.x`. HUD text at `object.x = 6` renders at `canvas_x = PANEL_WIDTH + 6 = 106`.

No `setBounds` on either camera. A 16-tile sea border ensures map tiles always fill the viewport even at the playable edge.

### Spectator mode (MP)

When the local tank dies in MP, `spectatorMode = true`. Q/E keys cycle `spectatorTargetIdx` through `ghostManager.getAlivePlayerIds()`. `cameras.main.startFollow(ghostSprite)` tracks the selected ghost. On respawn, camera re-attaches to local tank.

A `spectatorText` element (depth 30, scrollFactor 0, centered in viewport) shows "SPECTATING: [name]   [Q] / [E] to switch" while in spectator mode and is hidden on respawn.

### Minimap

- Prerendered 256×256 terrain texture (`'minimap_terrain'`) generated once in `buildMinimap()`: 1px per tile
- `minimapTerrain` sprite: scale 0.5 → 128×128 on screen, bottom-right of game viewport
- `minimapBlip` graphics: cleared + redrawn each frame — pillbox dots (green/red/grey), base dots (blue/orange), ghost player dots (team color), local player white circle, border rect
- Both ignored by `uiCam`

### HUD layout

- **Top-left of viewport** (cameras.main, depth 30, scrollFactor 0): speed + terrain + action state text
- **Left panel (0–100px)** (uiCam): ActionPanel buttons, stat bars, gear button
- **Stat bars** — start at y=512, stride 26px: HP (green), Shells (yellow), Mines (red), Trees (brown)
- **Kill feed** — bottom-right toast notifications (depth 31), timed removal
- **Timer** — top-center of game viewport
- **Minimap** — bottom-right, 128×128, depth 90–91; base blips: friendly=`0x44aaff`, neutral=`0xffffff`, enemy=`0xff4444`
- **Chyron** — game-viewport-width scrolling ticker anchored to the bottom of the game area (depth 33–35). Starts at the right edge of the panel (canvas x = PANEL_WIDTH), does not extend into the left panel. Created in `buildHUD()`; all three objects (bg, accent line, label) ignored by `uiCam`. Events pushed: player joined/left, tank destroyed, pillbox destroyed, base claimed, drowned, mine hit.

### Depth layer assignments

| Depth | Contents |
|---|---|
| 0 | Ground layer (tilemap) |
| 1 | Mine sprites |
| 2 | Base markers, start markers |
| 3 | Pillbox sprites |
| 4 | Pill crack overlays, pill pickup icons |
| 5 | Tank sprite, ghost tank sprites |
| 7 | Builder soldier |
| 8 | Explosion sprites |
| 20–23 | ActionPanel UI (uiCam) |
| 21–22 | Settings gear button (uiCam) |
| 22–23 | Stat bars (uiCam) |
| 30 | HUD text (cameras.main) |
| 32 | Kill feed (cameras.main) |
| 33 | Chyron background strip (cameras.main, game viewport only) |
| 34 | Chyron top-border accent line (cameras.main, game viewport only) |
| 35 | Chyron scrolling text (cameras.main, game viewport only) |
| 50–53 | Settings modal overlay (cameras.main) |
| 90–91 | Minimap terrain + blip (cameras.main) |

## Connects To

- `library/map.md` — tile types, terrain data, road bitmask
- `library/entities.md` — Tank, Pillbox, Bullet, mine, GhostTankManager details
- `library/builder.md` — Builder soldier, ActionPanel actions
- `library/network.md` — NetworkManager, multiplayer event protocol

## Update Triggers

- [ ] New texture generated in BootScene (add to sprite/icon table)
- [ ] Depth layer assignments changed
- [ ] Update loop order changed
- [ ] Camera or viewport configuration changed
- [ ] HUD layout changed
- [ ] Initialisation order changed
- [ ] LobbyScene views or fields changed
- [ ] Map upload flow changed
