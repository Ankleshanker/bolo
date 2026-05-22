# MAP SYSTEM
> Part of the Bolo library. See `library/index.md` for the full doc index.

## Overview

The map is a 256×256 grid of display tile indices stored in `mapData.terrain: number[][]`. The value at `[y][x]` is a `DisplayTile.*` constant (0–10). The tileset has 27 slots (indices 0–26); road variant tiles at 11–26 are computed dynamically and never stored in the terrain array.

---

## Source of Truth: `src/map/TileTypes.ts`

All tile constants live here. Always import from here — never define inline.

### `DisplayTile` constants

| Value | Name | Description |
|---|---|---|
| 0 | Sea | Deep water — sink animation on entry, no physics collision |
| 1 | Shallow | Shallow water — passable, very slow |
| 2 | Swamp | Sluggish terrain |
| 3 | Crater | Uneven ground |
| 4 | Road | Fast terrain, 16-variant auto-tiling |
| 5 | Forest | Slow; provides stealth; harvestable for trees; cleared by bullets; spreads to adjacent Grass over time |
| 6 | Rubble | Slightly slow |
| 7 | Grass | Baseline speed |
| 8 | Wall | Solid — physics collision block |
| 9 | DamagedWall | Passable, rough |
| 10 | Mountain | Impassable + indestructible — bullets die on contact, no damage chain, never harvestable |

### `TERRAIN_SPEED` (keyed by DisplayTile value)

| Tile | Multiplier | Notes |
|---|---|---|
| Sea (0) | 0.0 | Detected programmatically, not via physics |
| Shallow (1) | 0.25 | |
| Swamp (2) | 0.35 | |
| Crater (3) | 0.65 | |
| Road (4) | 1.30 | |
| Forest (5) | 0.55 | |
| Rubble (6) | 0.85 | |
| Grass (7) | 1.00 | Baseline |
| Wall (8) | 0.0 | Blocked by physics |
| DamagedWall (9) | 0.75 | |
| Mountain (10) | 0.0 | Blocked by physics; NOT in WALL_DAMAGE_CHAIN |

Used by Tank movement and Builder speed. Builder speed is clamped to `MIN_SPEED_MULT = 0.3` so it never stops completely.

### `COLLISION_TILES`

`[8, 10]` — Wall and Mountain. Sea is intentionally excluded; see Cross-Cutting Rule 3 in `CLAUDE.md`. Mountain is NOT in `WALL_DAMAGE_CHAIN`; bullets die on contact without degrading the tile.

### Road variant constants

- `ROAD_VARIANT_BASE = 11` — first road variant tileset index (shifted to make room for Mountain at index 10)
- Road variant index = `ROAD_VARIANT_BASE + bitmask` where bitmask: bit0=N, bit1=E, bit2=S, bit3=W
- 16 variants (indices 11–26) cover all neighbor combinations
- Stored only in `groundLayer` (visual layer), never in `mapData.terrain`

### Other constants

- `MAP_SIZE = 256` — grid dimensions (square)
- `TILE_SIZE = 32` — pixels per tile
- `TILESET_KEY = 'tileset'`
- `NUM_DISPLAY_TILES = 27` — total tileset slots (11 base + 16 road variants)

---

## Terrain Data Shape

```typescript
interface MapData {
  terrain: number[][];   // [y][x], DisplayTile values 0–9
  pills:   PillInfo[];   // { x, y, owner, armour, speed }
  bases:   BaseInfo[];   // { x, y, owner, armour, shells, mines }
  starts:  StartInfo[];  // { x, y, dir }
}
```

`terrain` is indexed `[row][col]` / `[y][x]`. Out-of-bounds reads return `undefined`; callers default with `?? DisplayTile.Grass` or `?? 0`.

---

## Map Sources

### `.bmap` file (`src/map/BoloMapParser.ts`)

Parses the classic Bolo binary format (RLE nibble-encoded rows). Raw 4-bit nibble values are converted to `DisplayTile` via `TERRAIN_TO_DISPLAY` at parse time — `mapData.terrain` always contains display indices, never raw nibbles.

Loaded in BootScene: `this.load.binary('mapdata', '/maps/test.bmap')`. GameScene reads from cache. If absent or malformed, falls back to the procedural map.

### Procedural generator (`src/map/ProceduralMap.ts`)

Used when no `.bmap` is available. Generates organic natural landscapes using diamond-square heightmaps. Key exports:
- `generateTestMap(seed?: number): MapData` — main entry point; seed defaults to `Date.now()`
- `CURRENT_SEED: number` — mutable export updated on each generation; read by the Settings panel

**Generation pipeline:**

1. **Heightmap** — `diamondSquare()` from `src/map/Noise.ts`; roughness randomised 0.45–0.65 per map; separate noise seed derived as `CURRENT_SEED ^ 0xDEADBEEF` to decouple noise from POI/river RNG
2. **Terrain from elevation** — thresholds mapped: Sea (<0.30) → Shallow → Swamp → Grass → Forest → Rubble → Mountain (≥0.90); 8–18 craters scattered on Grass tiles
3. **Rivers** — 2–4 springs at high elevation (h ≥ 0.83), min 30-tile separation; each river walks downhill (with jitter for meandering); 2-tile-wide Shallow channel + 1-tile Swamp banks; stops at Mountain or existing Sea
4. **Lake refinement** — flood-fill inland Sea pockets: ≤40 tiles → all Shallow; >40 tiles → Sea center + Shallow ring; Swamp added around all lake perimeters
5. **POIs** — one base per quadrant (min 60-tile separation); tank starts near each base (2-tile grass clearing); 16 pillboxes uniformly scattered (min 20 tiles from each other, 15 from bases/starts)
6. **Roads** — Prim's MST connecting all bases + starts; Bresenham lines for each edge; skips Mountain and Sea tiles
7. **Sea border** — final pass forces all tiles outside rows/cols 16–239 to Sea

Playable area: tiles 16–239 (PLAY_MIN/PLAY_MAX constants). The 16-tile sea border ensures camera centering even at the playable edge (16 × 32 = 512px > half-viewport).

---

## Tile Mutation: `setTile()` in `GameScene`

**Always use `setTile(tileX, tileY, displayTile)` to change terrain.** It:

1. Updates `mapData.terrain[y][x]`
2. For road tiles: calls `updateRoadAndNeighbors()` — recalculates bitmask for the changed tile and all 4 neighbors
3. For non-road tiles: calls `groundLayer.putTileAt(displayTile, ...)`
4. If overwriting a road tile with non-road: reconnects the 4 neighbors that previously counted that tile

Bypassing `setTile` with a direct `putTileAt` will desync `mapData.terrain` from the visual layer. All game logic (terrain speed, bullet/mine checks, builder target validation) reads `mapData.terrain`.

---

## Wall Damage Chain

Player bullets hitting wall tiles trigger progressive degradation over **10 cumulative hits**:

```
Wall (8) —5 hits→ DamagedWall (9) —3 more→ Rubble (6) —2 more→ Crater (3)
```

Defined as `WALL_HIT_THRESHOLDS: Record<number, { hitsNeeded: number; nextTile: number }>` in `GameScene`. Hit progress is tracked per tile position in `wallHits: Map<string, number>` (key `"tileX,tileY"`). `setTile()` clears any counter entry for the changed position, so remote tile-sync events always reset local hit progress.

In multiplayer, intermediate hits (below a transition threshold) are broadcast as `wallHit` events so all clients share cumulative progress. Tile transitions continue to broadcast via `tileChanged` as before.

Pillbox bullets don't damage terrain.

---

## Tree Spreading

Once per second, `GameScene.tickTreeSpread()` iterates all 256×256 terrain tiles. For each `DisplayTile.Forest` tile it rolls `Math.random() < TREE_SPREAD_CHANCE` (default `0.001`). On a hit, it picks one random tile from the 8 neighbors (including diagonals); if that neighbor is `DisplayTile.Grass`, it is converted to Forest via `setTile()`.

- **Rate:** ~1 new tree/second on a map with ~1,000 forest tiles. Adjust `TREE_SPREAD_CHANCE` in `GameScene.ts` to tune — `0.01` is noticeably fast; `0` disables.
- **Target:** Grass only. Sea, roads, walls, craters, etc. are never overwritten.
- **MP authority:** Host-only. The existing `setTile()` → `networkManager.sendTileChanged()` path broadcasts each new tile to all clients.
- **Performance:** Full O(65,536) scan each tick. See `library/decisions.md` ("Tree spreading iterates all tiles without a candidate cache") for why this is fine and how to add a cache if it ever matters.

---

## Connects To

- `library/scenes.md` — BootScene generates the tileset texture; GameScene builds and renders the tilemap
- `library/entities.md` — Pillbox and mine positions come from MapData; terrain affects entity speed

## Update Triggers

- [ ] New DisplayTile value added (update constants table and TERRAIN_SPEED)
- [ ] TERRAIN_SPEED values changed
- [ ] COLLISION_TILES changed
- [ ] Road variant bitmask logic changed
- [ ] BoloMapParser format support changed
- [ ] `setTile()` semantics changed
- [ ] Wall damage chain changed
