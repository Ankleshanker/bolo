# Decision Log

> Append-only. High bar for entry — only log decisions where a future agent reading the code might "improve" things in a way that breaks something, or make the same wrong choice you already ruled out.

---

## Documentation library established at Phase 1 — 2026-05-14

**Decision:** Set up the full project documentation library (CLAUDE.md, library/) at the end of Phase 1, before any gameplay mechanics exist.
**Why:** The codebase is small enough that invariants are clear and cheap to document accurately. Two cross-cutting issues were identified during doc writing — TILE_SIZE duplication and load-bearing tile array ordering — that would be non-obvious footguns in Phase 2 without documentation.
**Alternatives rejected:** Waiting until the codebase was larger would let undocumented gotchas accumulate across sessions and make the first doc writes more expensive and less accurate.
**Applies to:** All systems.

---

## Tile textures generated programmatically, not loaded from files — 2026-05-14

**Decision:** All tile and tank textures are generated at runtime via `Phaser.GameObjects.Graphics.generateTexture()` in BootScene. No external image files are loaded for tiles.
**Why:** Eliminates asset pipeline overhead at this stage; placeholder art is trivial to change by editing color constants. The texture keys are stable even when the visual representation changes.
**Alternatives rejected:** Loading PNGs via `this.load.image()` — unnecessary until real art exists, and would require managing asset files that will be replaced entirely.
**Applies to:** `src/scenes/BootScene.ts`, `library/scenes.md`.

---

## Physics-based builder movement, not tweens — 2026-05-15

**Decision:** The builder soldier is a `Phaser.Physics.Arcade.Sprite` driven by velocity each frame, not a Phaser tween.
**Why:** Tweens bypass the physics engine — the soldier would pass straight through walls and pillboxes. Velocity-based movement integrates naturally with arcade physics colliders.
**Alternatives rejected:** `tweens.add({ x, y })` — no collision support. `PathFollower` — requires a nav mesh, which is overkill for a grid-based map.
**Applies to:** `src/entities/Builder.ts`.

---

## Sea excluded from `COLLISION_TILES` — 2026-05-15

**Decision:** `COLLISION_TILES = [8]` (Wall only). Sea is detected programmatically each frame.
**Why:** A physics collision against sea would stop the tank at the shoreline. The sink animation requires the tank to physically enter the water tile — the tile-check in `update()` fires the 900ms tween + kill sequence. If sea were a collision tile, the tank would bounce off the edge and the animation would never play.
**Alternatives rejected:** Adding Sea (0) to `COLLISION_TILES` — silently breaks the sink mechanic.
**Applies to:** `src/map/TileTypes.ts`, `src/scenes/GameScene.ts` (`startSinking`).

---

## `mapData.terrain` stores display indices, not raw nibbles — 2026-05-15

**Decision:** All terrain arrays use `DisplayTile.*` values (0–9), regardless of data source. The `.bmap` parser applies `TERRAIN_TO_DISPLAY` at parse time before populating the array.
**Why:** All game logic (speed lookups, tile comparisons, `setTile` mutations, collision checks) keys off display indices. Storing raw nibble values would require translation at every callsite.
**Alternatives rejected:** Storing raw nibbles (0–15) and converting on read — doubles complexity at every comparison site and introduces a class of off-by-one bugs when comparing against `DisplayTile.*` constants.
**Applies to:** `src/map/BoloMapParser.ts`, `src/map/TileTypes.ts`.

---

## Camera viewport offset, not panel overlay — 2026-05-15

**Decision:** `cameras.main.setViewport(PANEL_WIDTH, 0, 860, 640)` physically restricts where the map camera renders. The ActionPanel is drawn in screen space at `scrollFactor 0` within the left 100px.
**Why:** Without the viewport inset, the tilemap renders beneath the panel UI. A `setViewport` call physically restricts camera drawing to the right 860px — no tile bleeds into the panel area regardless of camera position. No `setBounds` is set, so the camera freely centers on the tank at all times; the 16-tile sea border ensures map tiles always fill the viewport.
**Alternatives rejected:** Leaving camera full-width and rendering panel on top — tiles remain visible through any transparent panel regions; also confuses world-coordinate math.
**Applies to:** `src/scenes/GameScene.ts` (`setupCamera`), `src/ui/ActionPanel.ts`.

---

## Two-camera architecture for UI separation — 2026-05-15

**Decision:** A second camera `uiCam` with viewport `(0, 0, PANEL_WIDTH, H)` renders all left-panel UI objects. `cameras.main` ignores them; `uiCam` ignores game-world and HUD objects.
**Why:** `cameras.main` viewport starts at `x=PANEL_WIDTH`. `scrollFactor(0)` objects rendered by cameras.main get a `+PANEL_WIDTH` canvas offset: button at world `x=50` renders at canvas `x=150`, outside the `pointer.x < PANEL_WIDTH` guard — clicks appear to fall in the game world. By assigning panel objects exclusively to `uiCam` (viewport `x=0`), their canvas positions equal their world positions, making the guard work correctly.
**Alternatives rejected:** `scrollFactor(0)` on a single camera — the viewport offset invalidates the guard. Pointer offset subtraction — fragile and doesn't fix Phaser's interactive hit areas.
**Applies to:** `src/scenes/GameScene.ts` (`setupUiCamera`), `src/ui/ActionPanel.ts`, `src/ui/SettingsPanel.ts`.

---

## Mountain tile as a distinct DisplayTile — 2026-05-15

**Decision:** `DisplayTile.Mountain = 10` is a separate constant (not Wall). It is in `COLLISION_TILES` but NOT in `WALL_DAMAGE_CHAIN`. `ROAD_VARIANT_BASE` shifted from 10 → 11; `NUM_DISPLAY_TILES` bumped to 27.
**Why:** Mountain is impassable and indestructible — bullets die on contact without any tile degradation. Using Wall (8) would put it in the damage chain (Wall → DamagedWall → Rubble → Crater), making mountains gradually destructible. The separate constant keeps the invariant explicit and prevents accidental inclusion in future damage logic.
**Alternatives rejected:** Reusing Wall tile — silently erodes mountains via bullet damage. DamagedWall as "cracked mountain" — wrong semantic; mountain should be indestructible at any armor level.
**Applies to:** `src/map/TileTypes.ts`, `src/scenes/GameScene.ts` (`WALL_DAMAGE_CHAIN`), `src/scenes/BootScene.ts`.

---

## Diamond-square heightmap for procedural terrain — 2026-05-15

**Decision:** Organic maps are generated by a seeded diamond-square fractal heightmap (`src/map/Noise.ts`), then terrain types are assigned by elevation thresholds. Rivers, lakes, POIs, and roads are layered as post-processing passes.
**Why:** Diamond-square produces natural-looking landmass with coastlines, highlands, and valleys in a single deterministic pass. Threshold-based classification maps elevation cleanly to Bolo terrain types. Seeding the noise with a derived value (`CURRENT_SEED ^ 0xDEADBEEF`) decouples the noise pattern from the POI/river RNG so those passes can use the shared PRNG without perturbing the heightmap.
**Alternatives rejected:** Cellular automata — good for cave-like maps, not open terrain. Voronoi biomes — more complex with no visual improvement at Bolo scale. Perlin noise — not in standard library; diamond-square is self-contained.
**Applies to:** `src/map/Noise.ts`, `src/map/ProceduralMap.ts`.
