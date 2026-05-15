import type { MapData, PillInfo, BaseInfo, StartInfo } from './MapData';
import { DisplayTile, MAP_SIZE } from './TileTypes';
import { diamondSquare } from './Noise';

// ─── Public seed (readable by Settings panel) ────────────────────────────────
export let CURRENT_SEED = 0;

// ─── Elevation thresholds → terrain ──────────────────────────────────────────
// Tuned so: coast appears naturally at the edge of the playable interior,
// swamp rings low inland areas, forests cluster at mid-high elevation,
// mountains occupy only the highest peaks (~10-15% of land).
const T_SEA      = 0.30; // below → Sea
const T_SHALLOW  = 0.36; // Sea–Shallow boundary
const T_SWAMP    = 0.42; // Shallow–Swamp boundary  (narrow ~6pt band → ~10% of land)
const T_GRASS    = 0.74; // Swamp–Grass boundary    (wide  ~32pt band → ~50% of land)
const T_FOREST   = 0.86; // Grass–Forest boundary   (~12pt band → ~25% of land)
const T_RUBBLE   = 0.91; // Forest–Rubble (rocky approach to mountains)
const T_MOUNTAIN = 0.94; // Rubble–Mountain boundary (~3pt band → ~10% of land)

// Roughness range: randomised per map between 0.45 and 0.65
const ROUGHNESS_MIN = 0.45;
const ROUGHNESS_MAX = 0.65;

// Playable area bounds (tile coords, inclusive) — 16-tile sea border required
const PLAY_MIN = 16;
const PLAY_MAX = MAP_SIZE - 17; // = 239

// ─── Seeded PRNG (shared across generation, reset from CURRENT_SEED) ─────────
let _rng = 0;
function seedRng(s: number) { _rng = s >>> 0; }

// Mulberry32 — same algorithm as Noise.ts for consistency
function rng(): number {
  _rng += 0x6d2b79f5;
  let t = _rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
}

function rngRange(lo: number, hi: number) { return lo + rng() * (hi - lo); }
function rngInt(lo: number, hi: number)   { return Math.floor(rngRange(lo, hi + 1)); }

// ─── Helpers ─────────────────────────────────────────────────────────────────
function set(terrain: number[][], x: number, y: number, tile: number) {
  if (x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE) terrain[y][x] = tile;
}
function get(terrain: number[][], x: number, y: number): number {
  return terrain[y]?.[x] ?? DisplayTile.Sea;
}

function isPassable(t: number): boolean {
  return t !== DisplayTile.Sea && t !== DisplayTile.Shallow && t !== DisplayTile.Mountain;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

// ─── Phase C: Terrain from heightmap ─────────────────────────────────────────
function applyHeightmap(
  terrain: number[][],
  heightmap: Float32Array,
): void {
  // heightmap is 257×257; sample at tile centre using bilinear interpolation
  // tile (tx, ty) → heightmap sample at (tx, ty) — good enough at this resolution
  for (let ty = PLAY_MIN; ty <= PLAY_MAX; ty++) {
    for (let tx = PLAY_MIN; tx <= PLAY_MAX; tx++) {
      // Map tile coords into heightmap coords (0-256)
      const hx = Math.round((tx - PLAY_MIN) / (PLAY_MAX - PLAY_MIN) * 256);
      const hy = Math.round((ty - PLAY_MIN) / (PLAY_MAX - PLAY_MIN) * 256);
      const h  = heightmap[hy * 257 + hx];

      let tile: number;
      if      (h < T_SEA)      tile = DisplayTile.Sea;
      else if (h < T_SHALLOW)  tile = DisplayTile.Shallow;
      else if (h < T_SWAMP)    tile = DisplayTile.Swamp;
      else if (h < T_GRASS)    tile = DisplayTile.Grass;
      else if (h < T_FOREST)   tile = DisplayTile.Forest;
      else if (h < T_RUBBLE)   tile = DisplayTile.Rubble;
      else if (h < T_MOUNTAIN) tile = DisplayTile.Mountain;
      else                     tile = DisplayTile.Mountain;

      terrain[ty][tx] = tile;
    }
  }

  // Scatter craters on grass — target ~5% of grass tiles by random cluster placement
  const grassTiles: Array<[number, number]> = [];
  for (let ty2 = PLAY_MIN; ty2 <= PLAY_MAX; ty2++) {
    for (let tx2 = PLAY_MIN; tx2 <= PLAY_MAX; tx2++) {
      if (terrain[ty2][tx2] === DisplayTile.Grass) grassTiles.push([tx2, ty2]);
    }
  }
  const craterTarget = Math.floor(grassTiles.length * 0.05);
  let cratersFilled = 0;
  let craterAttempts = 0;
  while (cratersFilled < craterTarget && craterAttempts < craterTarget * 10) {
    craterAttempts++;
    const idx = Math.floor(rng() * grassTiles.length);
    const [cx, cy] = grassTiles[idx];
    if (terrain[cy][cx] !== DisplayTile.Grass) continue;
    const r = rngInt(1, 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r && terrain[cy + dy]?.[cx + dx] === DisplayTile.Grass) {
          set(terrain, cx + dx, cy + dy, DisplayTile.Crater);
          cratersFilled++;
        }
      }
    }
  }
}

// ─── Phase D: Rivers ─────────────────────────────────────────────────────────
// Rivers flow from a high-elevation spring point downhill to the nearest Sea/Shallow.
// Each river is 2 tiles wide. Banks get a 1-tile Swamp fringe.
function generateRivers(terrain: number[][], heightmap: Float32Array): void {
  const RIVER_COUNT    = rngInt(2, 4);
  const MIN_SPRING_SEP = 30; // minimum tile distance between spring points

  const springs: Array<{ x: number; y: number }> = [];

  for (let attempt = 0; attempt < 200 && springs.length < RIVER_COUNT; attempt++) {
    const tx = rngInt(PLAY_MIN + 10, PLAY_MAX - 10);
    const ty = rngInt(PLAY_MIN + 10, PLAY_MAX - 10);
    const hx = Math.round((tx - PLAY_MIN) / (PLAY_MAX - PLAY_MIN) * 256);
    const hy = Math.round((ty - PLAY_MIN) / (PLAY_MAX - PLAY_MIN) * 256);
    const h  = heightmap[hy * 257 + hx];

    // Spring must be in rubble/mountain zone
    if (h < T_RUBBLE) continue;
    if (springs.some(s => distance(s.x, s.y, tx, ty) < MIN_SPRING_SEP)) continue;
    springs.push({ x: tx, y: ty });
  }

  for (const spring of springs) {
    carveRiver(terrain, heightmap, spring.x, spring.y);
  }
}

function carveRiver(
  terrain: number[][],
  heightmap: Float32Array,
  startX: number,
  startY: number,
): void {
  const MAX_STEPS = 300;
  let cx = startX;
  let cy = startY;
  const visited = new Set<number>();

  for (let step = 0; step < MAX_STEPS; step++) {
    const key = cy * MAP_SIZE + cx;
    if (visited.has(key)) break;
    visited.add(key);

    const cur = terrain[cy]?.[cx];
    if (cur === DisplayTile.Sea) break; // reached the sea

    // Widen river: paint a 2-tile wide channel (current + right/below offset)
    const riverTiles: Array<[number, number]> = [
      [cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1],
    ];
    for (const [rx, ry] of riverTiles) {
      if (get(terrain, rx, ry) !== DisplayTile.Mountain) {
        set(terrain, rx, ry, DisplayTile.Shallow);
      }
    }

    // Swamp bank (1-tile fringe around the river channel)
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++) {
        const t = get(terrain, cx + dx, cy + dy);
        if (t !== DisplayTile.Shallow && t !== DisplayTile.Sea && t !== DisplayTile.Mountain) {
          set(terrain, cx + dx, cy + dy, DisplayTile.Swamp);
        }
      }
    }

    // Step: move to neighbor with lowest heightmap value (downhill)
    const candidates = [
      [cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1],
      [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1],
    ];

    let bestH = Infinity;
    let bestX = cx;
    let bestY = cy;

    for (const [nx, ny] of candidates) {
      if (nx < PLAY_MIN || nx > PLAY_MAX || ny < PLAY_MIN || ny > PLAY_MAX) continue;
      if (visited.has(ny * MAP_SIZE + nx)) continue;
      if (get(terrain, nx, ny) === DisplayTile.Mountain) continue;
      const nhx = Math.round((nx - PLAY_MIN) / (PLAY_MAX - PLAY_MIN) * 256);
      const nhy = Math.round((ny - PLAY_MIN) / (PLAY_MAX - PLAY_MIN) * 256);
      const nh  = heightmap[nhy * 257 + nhx];
      // Add a small random perturbation so rivers meander rather than form perfectly straight lines
      const jitter = rng() * 0.02;
      if (nh + jitter < bestH) {
        bestH  = nh + jitter;
        bestX  = nx;
        bestY  = ny;
      }
    }

    if (bestX === cx && bestY === cy) break; // stuck
    cx = bestX;
    cy = bestY;
  }
}

// ─── Inland lake detection: small inland Sea pockets become Shallow ───────────
// After rivers are carved, some inland depressions become enclosed Sea pockets.
// These function as inland lakes/ponds. Mark their interiors as Shallow (lake)
// with Sea centers if they're large enough.
function refineLakes(terrain: number[][]): void {
  const visited = new Set<number>();

  for (let ty = PLAY_MIN; ty <= PLAY_MAX; ty++) {
    for (let tx = PLAY_MIN; tx <= PLAY_MAX; tx++) {
      if (terrain[ty][tx] !== DisplayTile.Sea) continue;
      if (visited.has(ty * MAP_SIZE + tx)) continue;

      // Flood-fill this sea body to measure size and check if it touches the border
      const body: Array<[number, number]> = [];
      const queue: Array<[number, number]> = [[tx, ty]];
      let touchesBorder = false;

      while (queue.length > 0) {
        const [qx, qy] = queue.pop()!;
        const qk = qy * MAP_SIZE + qx;
        if (visited.has(qk)) continue;
        visited.add(qk);
        body.push([qx, qy]);

        if (qx <= PLAY_MIN || qx >= PLAY_MAX || qy <= PLAY_MIN || qy >= PLAY_MAX) {
          touchesBorder = true;
        }

        for (const [nx, ny] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]]) {
          if (nx < PLAY_MIN || nx > PLAY_MAX || ny < PLAY_MIN || ny > PLAY_MAX) continue;
          if (visited.has(ny * MAP_SIZE + nx)) continue;
          if (terrain[ny]?.[nx] === DisplayTile.Sea) queue.push([nx, ny]);
        }
      }

      if (!touchesBorder) {
        // Inland lake: small → all Shallow; large → Sea center + Shallow ring
        for (const [lx, ly] of body) {
          terrain[ly][lx] = body.length > 40 ? DisplayTile.Sea : DisplayTile.Shallow;
        }
        // Swamp around the lake
        for (const [lx, ly] of body) {
          for (const [nx, ny] of [[lx - 1, ly], [lx + 1, ly], [lx, ly - 1], [lx, ly + 1]]) {
            const t = get(terrain, nx, ny);
            if (t !== DisplayTile.Sea && t !== DisplayTile.Shallow && t !== DisplayTile.Mountain) {
              set(terrain, nx, ny, DisplayTile.Swamp);
            }
          }
        }
      }
    }
  }
}

// ─── Phase E: POI placement ───────────────────────────────────────────────────
// Bases: one per quadrant; Starts: near each base; Pills: uniformly distributed.

function placePOIs(terrain: number[][]): {
  bases:  BaseInfo[];
  starts: StartInfo[];
  pills:  PillInfo[];
} {
  const PILL_COUNT     = 16;
  const MIN_BASE_SEP   = 60;
  const MIN_PILL_SEP   = 20;
  const MIN_PILL_BASE  = 15;

  // Quadrant definitions: [xLo, xHi, yLo, yHi]
  const quadrants: Array<[number, number, number, number]> = [
    [PLAY_MIN, 110, PLAY_MIN, 110],  // TL
    [130, PLAY_MAX, PLAY_MIN, 110],  // TR
    [PLAY_MIN, 110, 130, PLAY_MAX],  // BL
    [130, PLAY_MAX, 130, PLAY_MAX],  // BR
  ];

  const bases: BaseInfo[]   = [];
  const starts: StartInfo[] = [];
  const pills:  PillInfo[]  = [];

  // --- Place bases (one per quadrant) ---
  for (const [qxLo, qxHi, qyLo, qyHi] of quadrants) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const bx = rngInt(qxLo + 3, qxHi - 3);
      const by = rngInt(qyLo + 3, qyHi - 3);
      if (!isPassable(get(terrain, bx, by))) continue;
      if (get(terrain, bx, by) === DisplayTile.Forest) continue;
      if (bases.some(b => distance(b.x, b.y, bx, by) < MIN_BASE_SEP)) continue;
      bases.push({ x: bx, y: by, owner: 0xFF, armour: 90, shells: 90, mines: 90 });
      // Start position near the base
      const dir = rngInt(0, 15);
      for (let sa = 0; sa < 50; sa++) {
        const sx = bx + rngInt(-12, 12);
        const sy = by + rngInt(-12, 12);
        if (!isPassable(get(terrain, sx, sy))) continue;
        if (distance(sx, sy, bx, by) < 5) continue;
        starts.push({ x: sx, y: sy, dir });
        // Clear a 2-tile grass patch around the start so the tank spawns on open ground
        for (let dy2 = -2; dy2 <= 2; dy2++) {
          for (let dx2 = -2; dx2 <= 2; dx2++) {
            const t = get(terrain, sx + dx2, sy + dy2);
            if (t !== DisplayTile.Sea && t !== DisplayTile.Mountain) {
              set(terrain, sx + dx2, sy + dy2, DisplayTile.Grass);
            }
          }
        }
        break;
      }
      break;
    }
  }

  // Ensure we have at least one start even if placement failed
  if (starts.length === 0) starts.push({ x: 60, y: 60, dir: 0 });

  // --- Place pillboxes (uniform scatter, min separation from each other and POIs) ---
  const allPOIs = [...bases, ...starts];

  for (let attempt = 0; attempt < 2000 && pills.length < PILL_COUNT; attempt++) {
    const px = rngInt(PLAY_MIN + 2, PLAY_MAX - 2);
    const py = rngInt(PLAY_MIN + 2, PLAY_MAX - 2);
    const t  = get(terrain, px, py);
    if (!isPassable(t)) continue;
    if (t === DisplayTile.Forest) continue;
    if (pills.some(p => distance(p.x, p.y, px, py) < MIN_PILL_SEP)) continue;
    if (allPOIs.some(p => distance(p.x, p.y, px, py) < MIN_PILL_BASE)) continue;
    pills.push({ x: px, y: py, owner: 0xFF, armour: 15, speed: 4 });
  }

  return { bases, starts, pills };
}

// ─── Phase E: Road network (MST + Bresenham) ─────────────────────────────────
function buildRoads(
  terrain: number[][],
  bases:   BaseInfo[],
  starts:  StartInfo[],
): void {
  // Nodes = all bases and starts
  const nodes = [
    ...bases.map(b  => ({ x: b.x, y: b.y })),
    ...starts.map(s => ({ x: s.x, y: s.y })),
  ];
  if (nodes.length < 2) return;

  // Prim's algorithm for MST
  const inTree = new Set<number>();
  inTree.add(0);
  const edges: Array<[number, number]> = [];

  while (inTree.size < nodes.length) {
    let bestDist = Infinity;
    let bestFrom = -1;
    let bestTo   = -1;
    for (const fi of inTree) {
      for (let ti = 0; ti < nodes.length; ti++) {
        if (inTree.has(ti)) continue;
        const d = distance(nodes[fi].x, nodes[fi].y, nodes[ti].x, nodes[ti].y);
        if (d < bestDist) { bestDist = d; bestFrom = fi; bestTo = ti; }
      }
    }
    if (bestTo === -1) break;
    inTree.add(bestTo);
    edges.push([bestFrom, bestTo]);
  }

  // Axis-aligned L-road between each MST edge — skip Mountain and Sea tiles
  for (const [fi, ti] of edges) {
    lRoad(terrain, nodes[fi].x, nodes[fi].y, nodes[ti].x, nodes[ti].y);
  }
}

// Paint one tile as road (skipping Mountain and Sea)
function paintRoad(terrain: number[][], x: number, y: number): void {
  const t = get(terrain, x, y);
  if (t !== DisplayTile.Mountain && t !== DisplayTile.Sea) {
    set(terrain, x, y, DisplayTile.Road);
  }
}

// L-shaped road: walk horizontally then vertically (or vice versa, alternated by rng)
function lRoad(
  terrain: number[][],
  x0: number, y0: number,
  x1: number, y1: number,
): void {
  const hFirst = rng() < 0.5; // randomise which axis goes first

  if (hFirst) {
    // Horizontal segment
    const stepX = x0 < x1 ? 1 : -1;
    for (let x = x0; x !== x1; x += stepX) paintRoad(terrain, x, y0);
    // Vertical segment
    const stepY = y0 < y1 ? 1 : -1;
    for (let y = y0; y !== y1 + stepY; y += stepY) paintRoad(terrain, x1, y);
  } else {
    // Vertical segment
    const stepY = y0 < y1 ? 1 : -1;
    for (let y = y0; y !== y1; y += stepY) paintRoad(terrain, x0, y);
    // Horizontal segment
    const stepX = x0 < x1 ? 1 : -1;
    for (let x = x0; x !== x1 + stepX; x += stepX) paintRoad(terrain, x, y1);
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export function generateTestMap(providedSeed?: number): MapData {
  // Seed: provided (Settings) or random
  CURRENT_SEED = providedSeed ?? Math.floor(Math.random() * 0xFFFFFFFF);
  seedRng(CURRENT_SEED);

  const roughness = ROUGHNESS_MIN + rng() * (ROUGHNESS_MAX - ROUGHNESS_MIN);

  // Use a second seed derived from CURRENT_SEED for the noise (so rng() calls
  // in later phases don't shift the noise result)
  const noiseSeed = (CURRENT_SEED ^ 0xDEADBEEF) >>> 0;
  const heightmap = diamondSquare(noiseSeed, roughness);

  // Initialize entire map to Sea
  const terrain: number[][] = Array.from({ length: MAP_SIZE }, () =>
    new Array(MAP_SIZE).fill(DisplayTile.Sea),
  );

  // Phase C: terrain from heightmap (playable interior only)
  applyHeightmap(terrain, heightmap);

  // Phase D: rivers and inland lake refinement
  generateRivers(terrain, heightmap);
  refineLakes(terrain);

  // Phase E: POI placement, road network
  const { bases, starts, pills } = placePOIs(terrain);
  buildRoads(terrain, bases, starts);

  // Force sea border (16-tile ring) — always last so nothing overwrites it
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (x < PLAY_MIN || x > PLAY_MAX || y < PLAY_MIN || y > PLAY_MAX) {
        terrain[y][x] = DisplayTile.Sea;
      }
    }
  }

  return { terrain, pills, bases, starts };
}
