# Bolo

A browser-based clone of the 1987/1993 classic Bolo. 2D tile-based tank combat on a 256×256 tile map. Fullscreen responsive canvas. Phases 1–5 (full single-player loop) plus major Phase 7 features (minimap, sound, base capture, organic map generator, settings UI) are complete. Multiplayer is the next major milestone.

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Game engine | Phaser | 4.1.0 |
| Language | TypeScript | 6.0.2 |
| Bundler / dev server | Vite | 8.0.12 |

## Roadmap

- [x] Phase 1 — Scaffold: scene pipeline, tilemap renders, tank spawns, camera follows
- [x] Phase 2 — Tank movement: arcade physics, terrain speed modifiers, 16-direction rotation snap
- [x] Phase 3 — Collision: tank vs walls/pillboxes, bullets vs terrain/pillboxes, sea sink animation
- [x] Phase 4 — Combat: bullets, pillbox AI, health, capture, crack overlay, pill pickups
- [x] Phase 5 — Builder & bases: tree harvest, road/wall/pillbox placement, mines, resupply
- [ ] Phase 6 — Multiplayer: Socket.io server + client sync, lobby
- [~] Phase 7 — Polish: minimap ✓, sound ✓, base capture ✓, organic map generator ✓, settings UI ✓; pixel art pass, map selector, win condition remaining

## Library Routing

| System | Doc |
|---|---|
| Scene pipeline (BootScene → GameScene, texture inventory) | `library/scenes.md` |
| Map system (tile types, terrain data, road bitmask, .bmap loading) | `library/map.md` |
| Entities (Tank, Pillbox, Bullet, mines) | `library/entities.md` |
| Builder mechanic (ActionPanel, soldier, build actions, costs) | `library/builder.md` |
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
