/**
 * Diamond-Square heightmap generator.
 * Returns a 257×257 Float32Array (row-major, index = y*257 + x) with values in [0, 1].
 */
export function diamondSquare(seed: number, roughness: number): Float32Array {
  const SIZE = 257; // 2^8 + 1
  const grid = new Float32Array(SIZE * SIZE);

  // Mulberry32 PRNG — deterministic, fast, good distribution
  let s = seed >>> 0;
  function prng(): number {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  function get(x: number, y: number): number {
    // Clamp to edges (no wrap for heightmap borders)
    x = Math.max(0, Math.min(SIZE - 1, x));
    y = Math.max(0, Math.min(SIZE - 1, y));
    return grid[y * SIZE + x];
  }

  function set(x: number, y: number, v: number): void {
    grid[y * SIZE + x] = v;
  }

  // Seed the four corners with random values
  set(0,        0,        prng());
  set(SIZE - 1, 0,        prng());
  set(0,        SIZE - 1, prng());
  set(SIZE - 1, SIZE - 1, prng());

  let step = SIZE - 1; // starts at 256
  let range = 1.0;

  while (step > 1) {
    const half = step >> 1;

    // --- Diamond step ---
    // For each square, compute the midpoint from 4 corners + displacement
    for (let y = 0; y < SIZE - 1; y += step) {
      for (let x = 0; x < SIZE - 1; x += step) {
        const avg =
          (get(x,        y) +
           get(x + step, y) +
           get(x,        y + step) +
           get(x + step, y + step)) * 0.25;
        set(x + half, y + half, avg + (prng() * 2 - 1) * range);
      }
    }

    // --- Square step ---
    // For each diamond, compute the midpoint from cardinal neighbors + displacement
    // We iterate over all points at distance `half` from the grid lines of size `step`
    for (let y = 0; y < SIZE; y += half) {
      // Alternate starting x each row so we hit diamond centers
      const xStart = ((y / half) % 2 === 0) ? half : 0;
      for (let x = xStart; x < SIZE; x += step) {
        const avg =
          (get(x - half, y) +
           get(x + half, y) +
           get(x,        y - half) +
           get(x,        y + half)) * 0.25;
        set(x, y, avg + (prng() * 2 - 1) * range);
      }
    }

    range *= roughness;
    step = half;
  }

  // Normalize to [0, 1]
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < min) min = grid[i];
    if (grid[i] > max) max = grid[i];
  }
  const span = max - min;
  if (span > 0) {
    for (let i = 0; i < grid.length; i++) {
      grid[i] = (grid[i] - min) / span;
    }
  }

  return grid;
}
