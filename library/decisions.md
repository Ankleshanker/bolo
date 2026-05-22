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
**Applies to:** `src/map/TileTypes.ts`, `src/scenes/GameScene.ts` (`WALL_HIT_THRESHOLDS`), `src/scenes/BootScene.ts`.

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

## Base HP, supply, and combat recapture — 2026-05-18

**Decision:** Bases now require combat to recapture: each owned base has `BASE_MAX_HEALTH = 4` HP tracked in `baseHealth[]`. Player bullets hitting an enemy base decrement HP via a `physics.add.overlap` on an invisible physics sprite group (`baseGroup`). At 0 HP the base turns neutral (white). Neutral bases are still captured by driving over them. Supply (`base.shells` 0–90, `base.mines` 0–20) replenishes over 5 minutes and is drawn down by the continuous-parking refuel (1-second ticks). Newly captured bases start with 0 supply.

**Color indicator:** The base rect lerps from full team/enemy color toward white as HP decreases (`_baseRectColor` helper, per-channel RGB lerp). At full HP the rect shows the owner's color; at 0 HP it's white. This runs on every damage event, capture, neutralize, and network sync.

**Supply sync (MP):** `_doBaseRefuel` broadcasts `sendBaseUpdate` after each successful refuel tick. This prevents long-running games from diverging when shells/mines are drawn faster than the 5-minute replenish rate. Client-independent replenishment still runs locally; the broadcast corrects drift once per second per parked player.

**Why:** Aligns gameplay with the original Bolo mechanic: bases have strategic value requiring defense, not just conquest. Supply scarcity and the 5-minute replenish window add resource pressure.
**Alternatives rejected:** Separate physics sprites for base bodies (considered using a `staticGroup`) — a regular dynamic group with `setImmovable(true)` is simpler and the performance difference is negligible at ≤8 bases per map. Per-frame supply sync to server — client-independent replenishment avoids constant traffic; supply is synced on capture events, refuel ticks, and in the snapshot.
**Applies to:** `src/scenes/GameScene.ts` (base methods, `setupCollision`, `_baseRectColor`), `src/network/types.ts`, `server/src/types.ts`, `src/network/NetworkManager.ts`.

---

## Host pre-seeds server snapshot to fix domination win condition — 2026-05-17

**Decision:** When `setupMultiplayer()` runs, the host immediately broadcasts all pillbox and base states as neutral (`ownerId: null`) via `sendPillboxUpdate` / `sendBaseUpdate`. This pre-populates the server snapshot before any player has captured anything.
**Why:** The server's domination check compares all entries in `snapshot.pillboxStates` and `snapshot.baseStates`. If the snapshot is empty (no updates yet), capturing one objective creates a snapshot with one entry — all known entries are owned by the same player, triggering a false win. Pre-seeding ensures the server knows total objective count from game start.
**Alternatives rejected:** Passing pill/base counts in the `startGame` event — the server broadcasts `gameStart` before clients load the map, so counts aren't known at that moment. Server-side map awareness — the server doesn't parse map files; all map logic lives client-side.
**Applies to:** `src/scenes/GameScene.ts` (`setupMultiplayer`), `server/src/GameRoom.ts` (`checkWinCondition`).

---

## Late-joiner snapshot requested by client, not relied on from server — 2026-05-18

**Decision:** At the end of `setupMultiplayer()`, after all net event handlers are registered, the client calls `networkManager.sendRequestSnapshot()`. This is the canonical mechanism for late joiners to receive current world state.
**Why:** The server sends `stateSnapshot` alongside `gameStart` for rooms in PLAYING state. But `scene.start()` queues the new scene for the next `requestAnimationFrame` tick — by the time the server's snapshot arrives over the WebSocket, `GameScene.create()` hasn't run and the `stateSnapshot` handler hasn't been registered. The event is silently dropped. Requesting it at the end of `setupMultiplayer()` guarantees the handler is in place when the response arrives.
**Alternatives rejected:** Buffering events in NetworkManager before any handler is registered — complicates the singleton and risks replaying stale data. Delaying `scene.start()` — requires artificial waits or more complex coordination with the Phaser scene pipeline.
**Applies to:** `src/scenes/GameScene.ts` (`setupMultiplayer`), `src/network/NetworkManager.ts` (`sendRequestSnapshot`), `server/src/index.ts` (`requestSnapshot` handler).

---

## Boat snapshot entries pruned on tile change — 2026-05-18

**Decision:** `GameRoom.updateTileChanged()` calls `removeBoatAt(tileX, tileY)` whenever a tile mutation is recorded, evicting any boat at that position from `snapshot.boats`.
**Why:** Boats sit on shallow water tiles. If a builder later fills that tile (e.g., road), all live clients destroy the boat via `tileChanged` — but without this fix the server snapshot still listed the boat. A late joiner would receive the snapshot, place a phantom boat sprite, and then receive the tile as non-water. Pruning in the same call that records the tile change keeps the snapshot self-consistent.
**Alternatives rejected:** Sending an explicit `boatRemoved` event — the tile change is already the signal; a separate event would be redundant and add a new event type.
**Applies to:** `server/src/GameRoom.ts` (`updateTileChanged`, `removeBoatAt`).

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

## Active Games list shows all rooms; private lock is a client-side UX gate — 2026-05-18

**Decision:** `LobbyManager.listAllActiveRooms()` returns every non-ended room regardless of `settings.isPublic`. The server's `joinRoom` handler has no `isPublic` enforcement gate. On the client, clicking a 🔒 row opens a modal that asks the player to type the 6-digit code; the code is compared against `room.code` which is already present in the `RoomSummary` payload. This is a UX friction gate, not a security gate.
**Why:** The primary use-case for showing private rooms is activity visibility (see who is playing). Hiding them entirely would make the list useless for that purpose. Enforcing access at the join level would be a meaningful security feature requiring server-side secret storage — a deliberate future decision, not a default. The client-side prompt is a reasonable middle ground: it deters accidental joins while keeping the implementation trivial.
**Critical:** Do not add `if (!room.settings.isPublic) return;` to the `joinRoom` handler thinking you're "fixing" an oversight. That would break late-join for private rooms and contradict the design above. If real access control is desired, the correct design is: the host sets a hashed password on room creation, the `joinRoom` payload includes the plaintext, and the server checks the hash. The list can still show the room.
**Applies to:** `server/src/LobbyManager.ts` (`listAllActiveRooms`), `server/src/index.ts` (`joinRoom` handler), `src/scenes/LobbyScene.ts` (`_renderMultiBrowse`, `_renderPrivatePrompt`, `_submitPrivateCode`).

---

## Wall durability uses a hit counter, not a single-step tile lookup — 2026-05-21

**Decision:** Wall destruction is tracked via `WALL_HIT_THRESHOLDS` (a per-tile-type `{ hitsNeeded, nextTile }` map) plus a `wallHits: Map<string, number>` counter in `GameScene`. Walls require 10 cumulative player-bullet hits to reach Crater (5 → DamagedWall, 3 more → Rubble, 2 more → Crater). In multiplayer, intermediate hits are broadcast as `wallHit` events so all clients share progress; tile transitions continue via `tileChanged`. `setTile()` always clears the counter for the changed position so remote syncs reset local progress. The server stores `wallHits: WallHitState[]` in the world snapshot so late joiners receive current damage progress.
**Why:** The original single-step `WALL_DAMAGE_CHAIN = { 8: 9, 9: 6, 6: 3 }` made walls trivially fragile — 3 bullets destroyed any wall. The hit counter lets the existing three visual states (Wall, DamagedWall, Rubble) provide meaningful feedback across 10 hits without adding new tile types or tileset frames.
**Do not simplify back to a single-step lookup** — that undoes the intentional durability design.
**Applies to:** `src/scenes/GameScene.ts` (`WALL_HIT_THRESHOLDS`, `hitWall`, `setTile`, `wallHits`), `src/network/NetworkManager.ts` (`sendWallHit`), `src/network/MultiplayerBridge.ts` (`wallHit` handler, `applySnapshot`), `server/src/index.ts` (`wallHit` relay), `server/src/GameRoom.ts` (`updateWallHit`, `removeWallHitAt`), `src/network/types.ts` + `server/src/types.ts` (`WallHitState`, `WorldSnapshot.wallHits`).

---

## Tree spreading iterates all tiles without a candidate cache — 2026-05-22

**Decision:** `tickTreeSpread()` runs once per second and does a full O(MAP_SIZE²) scan of `mapData.terrain`, rolling `Math.random() < TREE_SPREAD_CHANCE` for every `DisplayTile.Forest` tile it encounters. No pre-built list of forest tile coordinates is maintained.
**Why:** At 256×256 = 65,536 tiles, the scan completes in well under a frame budget (~0.1 ms). Building and maintaining a forest-tile index adds complexity with no measurable gain at this map size. The tick fires only once per second, so even if the map fills with forest the cost stays trivial.
**To tune spread rate:** Change `TREE_SPREAD_CHANCE` in `GameScene.ts` (currently `0.001` = 0.1% per forest tile per second). A map with ~1,000 forest tiles produces ~1 new tree/second on average. Raise toward `0.01` for noticeably faster growth; set to `0` to disable entirely.
**To add a candidate cache if performance ever matters:** Maintain a `Set<number>` of `y * MAP_SIZE + x` forest tile indices, updated in `setTile()` on Forest↔non-Forest transitions. Replace the double loop with iteration over that set.
**MP authority:** Host-only — the `!networkManager.isHost` guard mirrors the pillbox-AI pattern. Spread tiles are broadcast via the existing `setTile()` → `networkManager.sendTileChanged()` path so all clients stay in sync.
**Applies to:** `src/scenes/GameScene.ts` (`TREE_SPREAD_CHANCE`, `treeSpreadAccum`, `tickTreeSpread`).

---

## Pillbox team color passed explicitly, not re-queried per frame — 2026-05-21

**Decision:** The friendly-pill tint color is passed as an optional `teamColor?: number` through `addPill()` and `capture()`, stored nowhere — just applied once as a Phaser sprite tint. `MultiplayerBridge` derives it at the point of state application (`pillboxUpdate` / `applySnapshot`) via `networkManager.getPlayerColor(ownerId)`.
**Why:** Pillbox tinting happens on capture events (infrequent), not per-frame. Storing the owner's color on the `Pillbox` instance would require updating it whenever the player map changes (e.g. reconnect). Passing it at the event site is simpler, idempotent, and safe: if `getPlayerColor` returns white (player not yet in map), the next snapshot or `pillboxUpdate` will re-apply the correct color.
**Do not change `applyTeamTint()` to call `networkManager.getPlayerColor()` directly** — `Pillbox` has no reference to the NetworkManager and shouldn't need one; the tint source must flow in from outside. The localStorage fallback in `applyTeamTint` is only exercised for the local player's own pills in SP (where no `teamColor` is provided), which is correct.
**Applies to:** `src/entities/Pillbox.ts` (`applyTeamTint`, `capture`, constructor), `src/network/MultiplayerBridge.ts` (`pillboxUpdate`, `applySnapshot`).

---

## Cloudflare Workers Assets for client hosting — 2026-05-17

**Decision:** The client SPA is deployed as Cloudflare Workers Assets (via `npx wrangler deploy`) with a `wrangler.jsonc` config file. Not GitHub Pages; not Cloudflare Pages static hosting.
**Why:** The domain `bolo-online.com` is registered on Cloudflare. Workers Assets serves the Vite-built `dist/` as a SPA (`not_found_handling: single-page-application`) with global CDN distribution, zero cold-start latency, and direct DNS integration (no proxy hop needed for the game server WebSocket).
**Critical:** `vite.config.ts` must have `plugins: []` defined. Without it, wrangler's setup routine tries to inject itself as a Vite plugin and fails with `Cannot modify Vite config: could not find a valid plugins array`. The `wrangler.jsonc` must be committed to the repo — without it, wrangler runs in interactive setup mode on every deploy and tries to scaffold the project.
**Alternatives rejected:** GitHub Pages — required a `base: '/bolo/'` path prefix in Vite, which conflicted with the custom domain root. Cloudflare Pages static hosting — the project was created as a Worker, not a Pages project, and the dashboard required a deploy command; static Pages has no deploy command.
**Applies to:** `vite.config.ts`, `wrangler.jsonc`, `.github/workflows/deploy.yml`.
