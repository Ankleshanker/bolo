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

---

## Shooter-authoritative hit detection — 2026-05-17

**Decision:** The player who fires a bullet detects overlap between their `playerBullets.group` and the remote `ghostManager.group` using Phaser arcade physics. On overlap, they send `bulletHit { targetId, damage, shooterId }` to the server, which relays it to all clients. The victim applies damage on receiving the relay.
**Why:** Server-side bullet simulation would require the server to run the full physics step for every player — expensive and latency-sensitive. Client-side detection on the shooter is the most accurate for the shooter (no prediction lag), and the 100ms interpolation buffer keeps ghost positions close to reality. The victim does not apply damage from local physics — only from the server relay — preventing double-damage.
**Alternatives rejected:** Victim-side detection — victim's ghost is already behind on position, making near-miss shots register as hits. Full server simulation — prohibitive CPU cost for 16 players × 200 shells each.
**Applies to:** `src/scenes/GameScene.ts` (`setupCollision`, `bulletHit` handler), `src/network/NetworkManager.ts` (`sendBulletHit`).

---

## Victim self-reports death for kill attribution — 2026-05-17

**Decision:** When the victim receives a `bulletHit` relay and dies, they send `{ victimId: myId, killerId: shooterId }` back to the server. The server distinguishes victim-report (where `data.victimId === socket.playerId`) from shooter-report (where the shooter sends just `{ victimId }`).
**Why:** The shooter knows their own ID but not whether the hit was lethal; the victim knows they died and who killed them. Letting the victim confirm death prevents the shooter from falsely reporting a kill on a tank that had already used a base to heal. The dual-mode `playerKill` event handles both paths gracefully.
**Alternatives rejected:** Shooter-only kill report — race condition: victim could heal between shooter detecting the hit and the event arriving. Server health tracking — would require the server to replicate all damage logic.
**Applies to:** `src/scenes/GameScene.ts` (`bulletHit` handler, `sendPlayerKillSelf`), `server/src/index.ts` (playerKill handler), `src/network/types.ts` (`C2S_PlayerKill`).

---

## Ghost physics group for dynamic bullet overlap — 2026-05-17

**Decision:** `GhostTankManager` exposes a `readonly group: Phaser.Physics.Arcade.Group`. All ghost sprites are added to this group. `setupCollision()` registers one `physics.add.overlap(playerBullets.group, ghostManager.group, ...)` call at startup.
**Why:** Phaser arcade overlap callbacks must be registered against groups or specific sprites. If overlap were registered per-ghost on `addGhost()`, each ghost join would add another callback, causing duplicate processing. A single group overlap covers all current and future ghosts without re-registration.
**Alternatives rejected:** Re-registering overlaps on each `addGhost()` — double-fires for ghosts added after setup. Manual per-frame distance checks — bypasses physics broadphase optimisation.
**Applies to:** `src/network/GhostTankManager.ts`, `src/scenes/GameScene.ts` (`setupCollision`).

---

## Host pre-seeds server snapshot to fix domination win condition — 2026-05-17

**Decision:** When `setupMultiplayer()` runs, the host immediately broadcasts all pillbox and base states as neutral (`ownerId: null`) via `sendPillboxUpdate` / `sendBaseUpdate`. This pre-populates the server snapshot before any player has captured anything.
**Why:** The server's domination check compares all entries in `snapshot.pillboxStates` and `snapshot.baseStates`. If the snapshot is empty (no updates yet), capturing one objective creates a snapshot with one entry — all known entries are owned by the same player, triggering a false win. Pre-seeding ensures the server knows total objective count from game start.
**Alternatives rejected:** Passing pill/base counts in the `startGame` event — the server broadcasts `gameStart` before clients load the map, so counts aren't known at that moment. Server-side map awareness — the server doesn't parse map files; all map logic lives client-side.
**Applies to:** `src/scenes/GameScene.ts` (`setupMultiplayer`), `server/src/GameRoom.ts` (`checkWinCondition`).

---

## Host-authoritative pillbox AI — 2026-05-17

**Decision:** In multiplayer, only the host runs the full pillbox AI (picks nearest of all alive players, fires bullets, broadcasts `pillboxBulletFired {pillIndex, x, y, angleDeg}`). Non-hosts suppress local bullet firing (`bullets = null`) and fire locally only on receipt of the broadcast, relying on the existing `pillboxBullets` vs `tank.sprite` overlap for damage detection.
**Why:** Each client previously ran independent AI targeting only its own local tank. This caused pillboxes to aim differently on each screen and meant bullets never hit ghost tanks (no `pillboxBullets` vs `ghostManager.group` overlap existed). Making the host authoritative synchronises both targeting and bullet positions. Since `pillboxBullets` already overlaps `tank.sprite` on every machine, each client correctly self-detects damage from the replicated bullets without any new damage protocol.
**Applies to:** `src/entities/Pillbox.ts`, `src/scenes/GameScene.ts`, `src/network/NetworkManager.ts`, `src/network/GhostTankManager.ts`, `server/src/index.ts`.

---

## Tank-vs-tank collision: immovable ghost + shooter-sends-push — 2026-05-18

**Decision:** Ghost physics bodies are marked `immovable = true`. A Phaser arcade collider between `tank.sprite` and `ghostManager.group` gives the local tank solid collision against all remote players. When the local tank is faster, it sends a `tankPush` impulse over the network (rate-limited to 100 ms per pair); the server relays it only to the target socket, which applies it to that client's local tank. Ghost bodies are disabled (`body.enable = false`) whenever the ghost sprite is hidden (dead, enemy-in-forest) to prevent invisible blocking.
**Why:** Ghost positions are overwritten every frame by snapshot interpolation — Phaser physics can never displace them without causing jitter. Making ghosts immovable means all separation energy goes into the local tank, which is the one entity whose position we fully control. The network push follows the same shooter-authoritative model as bullet hits: the client with the most accurate local information (the tank doing the ramming) sends the event; the server caps the magnitude to prevent griefing.
**Alternatives rejected:** Mutable ghost physics — interpolation would snap the ghost back every frame, fighting the physics and causing visible jitter. Server-side collision simulation — would require the server to run a full physics step for every player pair, prohibitive at 16 players. Overlap instead of collider — overlap doesn't generate automatic separation, so the tank would still pass through; manual separation in the callback is more complex and less accurate.
**Applies to:** `src/network/GhostTankManager.ts` (`addGhost`, `update`, `getGhostVelocity`), `src/scenes/GameScene.ts` (`setupCollision`, `setupMultiplayer`), `src/network/NetworkManager.ts` (`sendTankPush`), `server/src/index.ts` (`tankPush` handler), `src/network/types.ts`, `server/src/types.ts`.

---

## Cloudflare Workers Assets for client hosting — 2026-05-17

**Decision:** The client SPA is deployed as Cloudflare Workers Assets (via `npx wrangler deploy`) with a `wrangler.jsonc` config file. Not GitHub Pages; not Cloudflare Pages static hosting.
**Why:** The domain `bolo-online.com` is registered on Cloudflare. Workers Assets serves the Vite-built `dist/` as a SPA (`not_found_handling: single-page-application`) with global CDN distribution, zero cold-start latency, and direct DNS integration (no proxy hop needed for the game server WebSocket).
**Critical:** `vite.config.ts` must have `plugins: []` defined. Without it, wrangler's setup routine tries to inject itself as a Vite plugin and fails with `Cannot modify Vite config: could not find a valid plugins array`. The `wrangler.jsonc` must be committed to the repo — without it, wrangler runs in interactive setup mode on every deploy and tries to scaffold the project.
**Alternatives rejected:** GitHub Pages — required a `base: '/bolo/'` path prefix in Vite, which conflicted with the custom domain root. Cloudflare Pages static hosting — the project was created as a Worker, not a Pages project, and the dashboard required a deploy command; static Pages has no deploy command.
**Applies to:** `vite.config.ts`, `wrangler.jsonc`, `.github/workflows/deploy.yml`.
