import { TILE_SIZE } from '../map/TileTypes';

// Visual definition for each display tile
export const TILE_DEFS: { fill: number; border: number }[] = [
  { fill: 0x005f6e, border: 0x005f6e },   // 0  Sea
  { fill: 0x1a9999, border: 0x1a9999 },   // 1  Shallow Sea
  { fill: 0x1e3a2a, border: 0x1a3224 },   // 2  Swamp
  { fill: 0x4a2c16, border: 0x2e1a08 },   // 3  Crater
  { fill: 0x8c7244, border: 0x6a5430 },   // 4  Road
  { fill: 0x081508, border: 0x081508 },   // 5  Forest
  { fill: 0x6e5f48, border: 0x504535 },   // 6  Rubble
  { fill: 0x2a4818, border: 0x2a4818 },   // 7  Grass
  { fill: 0x3e3e3e, border: 0x222222 },   // 8  Wall
  { fill: 0x606060, border: 0x404040 },   // 9  Damaged Wall
  { fill: 0x4e4538, border: 0x322c24 },   // 10 Mountain
];

export function drawTileDetails(gfx: Phaser.GameObjects.Graphics, index: number, x: number) {
  const T  = TILE_SIZE; // 32
  const ox = x;

  switch (index) {
    case 0: { // Sea — layered wave bands
      // Lighter band at mid-depth
      gfx.fillStyle(0x007a8e, 0.5);
      gfx.fillRect(ox, 6, T, 4);
      gfx.fillRect(ox, 20, T, 4);
      // Dark wave shapes (sinusoidal dots)
      gfx.fillStyle(0x003a50);
      for (let wy = 2; wy < T; wy += 9) {
        for (let wx = 0; wx < T; wx += 4) {
          const yo = Math.round(Math.sin((wx + wy * 2) * Math.PI / 10) * 2);
          const dy = wy + yo;
          if (dy >= 0 && dy + 2 <= T) gfx.fillRect(ox + wx, dy, 3, 1);
        }
      }
      // Specular glint
      gfx.fillStyle(0x44ccdd, 0.4);
      gfx.fillRect(ox + 4,  5, 6, 1);
      gfx.fillRect(ox + 18, 13, 5, 1);
      gfx.fillRect(ox + 9,  22, 7, 1);
      break;
    }

    case 1: { // Shallow Sea — sandy bottom visible through light water
      gfx.fillStyle(0x2ab8b8, 0.3);
      gfx.fillRect(ox, 0, T, T);
      // Sand patches
      gfx.fillStyle(0xd4b870, 0.35);
      gfx.fillCircle(ox + 8,  10, 5);
      gfx.fillCircle(ox + 22, 8,  4);
      gfx.fillCircle(ox + 14, 22, 6);
      gfx.fillCircle(ox + 4,  24, 3);
      gfx.fillCircle(ox + 26, 24, 4);
      // Ripple lines
      gfx.lineStyle(1, 0x50cccc, 0.4);
      gfx.lineBetween(ox + 2, 6,  ox + 12, 6);
      gfx.lineBetween(ox + 16, 16, ox + 28, 16);
      gfx.lineBetween(ox + 6, 26,  ox + 20, 26);
      break;
    }

    case 2: { // Swamp — waterlogged ground, blue-green water pockets, sparse grass
      // Muddy water patches
      gfx.fillStyle(0x1a5a50);
      gfx.fillRect(ox + 1,  3,  9, 5);
      gfx.fillRect(ox + 19, 1,  9, 4);
      gfx.fillRect(ox + 7,  19, 11, 6);
      gfx.fillRect(ox + 22, 17, 8,  8);
      gfx.fillRect(ox + 0,  25, 7,  6);
      // Water surface shimmer
      gfx.fillStyle(0x40a090, 0.55);
      gfx.fillRect(ox + 2,  4,  6, 2);
      gfx.fillRect(ox + 20, 2,  6, 1);
      gfx.fillRect(ox + 8,  20, 8, 2);
      gfx.fillRect(ox + 23, 18, 5, 1);
      // Mud rim around water patches
      gfx.fillStyle(0x2e2410);
      gfx.fillRect(ox + 1,  3,  9, 1);
      gfx.fillRect(ox + 19, 1,  9, 1);
      gfx.fillRect(ox + 7,  25, 11, 1);
      // Sparse waterlogged grass blades — olive/yellow-green
      gfx.fillStyle(0x5a7820);
      for (const [gx, gy, h] of [
        [12, 0, 4], [17, 1, 3], [29, 4, 4], [0, 11, 3], [5, 13, 4],
        [14, 10, 3], [22, 12, 4], [27, 9, 3], [2, 21, 3], [17, 24, 4],
        [29, 22, 3], [11, 28, 3], [25, 27, 4],
      ] as [number,number,number][]) {
        gfx.fillRect(ox + gx, gy, 1, h);
      }
      // Lighter blade tips
      gfx.fillStyle(0x7a9e30);
      for (const [gx, gy] of [
        [12, 0], [17, 1], [29, 4], [5, 13], [22, 12], [17, 24], [25, 27],
      ] as [number,number][]) {
        gfx.fillRect(ox + gx, gy, 1, 1);
      }
      break;
    }

    case 3: { // Crater — impact depression with debris ring
      // Outer scorched ring
      gfx.fillStyle(0x2a1808, 0.7);
      gfx.fillCircle(ox + 16, 16, 13);
      // Mid tone ring
      gfx.fillStyle(0x3c2410, 0.6);
      gfx.fillCircle(ox + 16, 16, 9);
      // Inner void
      gfx.fillStyle(0x160a04);
      gfx.fillCircle(ox + 16, 16, 5);
      // Impact lines radiating out
      gfx.lineStyle(1, 0x1e1008, 0.9);
      const angles = [0, 45, 90, 135, 180, 225, 270, 315];
      for (const a of angles) {
        const rad = a * Math.PI / 180;
        const x1 = ox + 16 + Math.cos(rad) * 5;
        const y1 = 16 + Math.sin(rad) * 5;
        const x2 = ox + 16 + Math.cos(rad) * 13;
        const y2 = 16 + Math.sin(rad) * 13;
        gfx.lineBetween(x1, y1, x2, y2);
      }
      // Rim highlight (NW lighting)
      gfx.fillStyle(0x6a4830, 0.7);
      gfx.fillRect(ox + 9, 8, 6, 2);
      gfx.fillRect(ox + 7, 10, 2, 4);
      break;
    }

    case 5: { // Forest — dense canopy viewed from above
      // Floor texture — dappled shadow
      gfx.fillStyle(0x0c1e0c, 0.5);
      gfx.fillRect(ox + 2, 2, 4, 4);
      gfx.fillRect(ox + 18, 6, 3, 3);
      gfx.fillRect(ox + 12, 24, 5, 4);
      gfx.fillRect(ox + 26, 22, 4, 4);
      gfx.fillRect(ox + 0, 18, 4, 3);

      // 5 tree canopies, 3 shades of green (outer → inner → highlight)
      const canopies: [number, number, number][] = [
        [8, 9, 8], [23, 8, 7], [15, 19, 8], [5, 25, 7], [26, 23, 7],
      ];
      for (const [tx, ty, r] of canopies) {
        gfx.fillStyle(0x1a5e1a);
        gfx.fillCircle(ox + tx, ty, r);
        gfx.fillStyle(0x2e8a2e);
        gfx.fillCircle(ox + tx - 1, ty - 1, Math.max(2, r - 2));
        gfx.fillStyle(0x44aa44);
        gfx.fillCircle(ox + tx - 2, ty - 2, Math.max(1, r - 4));
        // Highlight specular
        gfx.fillStyle(0x66cc66, 0.5);
        gfx.fillRect(ox + tx - 3, ty - 3, 2, 2);
      }
      break;
    }

    case 6: { // Rubble — broken masonry chunks
      // Large chunks
      gfx.fillStyle(0x5a5040);
      gfx.fillRect(ox + 3,  4,  7, 5);
      gfx.fillRect(ox + 18, 3,  6, 7);
      gfx.fillRect(ox + 8,  18, 8, 5);
      gfx.fillRect(ox + 22, 20, 6, 6);
      gfx.fillRect(ox + 2,  24, 5, 5);
      // Highlight edges (NW)
      gfx.fillStyle(0x8a7860, 0.8);
      gfx.fillRect(ox + 3,  4, 7, 1);
      gfx.fillRect(ox + 3,  4, 1, 5);
      gfx.fillRect(ox + 18, 3, 6, 1);
      gfx.fillRect(ox + 8,  18, 8, 1);
      // Shadow edges (SE)
      gfx.fillStyle(0x2a2418);
      gfx.fillRect(ox + 9,  8,  1, 1);
      gfx.fillRect(ox + 23, 9,  1, 1);
      gfx.fillRect(ox + 15, 22, 1, 1);
      // Small debris
      gfx.fillStyle(0x7a6a52, 0.6);
      for (const [dx, dy] of [[13,7],[6,14],[24,15],[11,27],[28,10],[1,10]]) {
        gfx.fillRect(ox + dx, dy, 2, 2);
      }
      break;
    }

    case 7: { // Grass — varied blade marks with subtle height variation
      // Slightly lighter patch
      gfx.fillStyle(0x304e1a, 0.4);
      gfx.fillCircle(ox + 10, 22, 7);
      gfx.fillCircle(ox + 24, 10, 6);
      // Blade marks — short vertical 1×2 or 1×3 lines in 3 greens
      const marks: [number, number, number, number, number][] = [
        [3,  2,  1, 3, 0x4e9430],
        [10, 4,  1, 2, 0x3a7222],
        [18, 1,  1, 3, 0x4e9430],
        [26, 4,  1, 2, 0x3a7222],
        [6,  10, 1, 3, 0x3a7222],
        [14, 9,  1, 2, 0x5aa838],
        [22, 11, 1, 3, 0x3a7222],
        [30, 9,  1, 2, 0x4e9430],
        [2,  18, 1, 3, 0x5aa838],
        [11, 17, 1, 2, 0x3a7222],
        [20, 19, 1, 3, 0x4e9430],
        [28, 17, 1, 2, 0x3a7222],
        [7,  26, 1, 3, 0x4e9430],
        [16, 25, 1, 2, 0x5aa838],
        [24, 27, 1, 3, 0x3a7222],
        [1,  28, 1, 2, 0x4e9430],
        [29, 28, 1, 3, 0x5aa838],
      ];
      for (const [gx, gy, w, h, col] of marks) {
        gfx.fillStyle(col);
        gfx.fillRect(ox + gx, gy, w, h);
      }
      break;
    }

    case 8: { // Wall — mortared brick with NW lighting
      // Mortar joints
      gfx.lineStyle(1, 0x1a1a1a);
      for (let wy = 0; wy < T; wy += 8) {
        gfx.lineBetween(ox, wy, ox + T, wy);
        const offset = ((wy / 8) % 2) === 0 ? 0 : 16;
        gfx.lineBetween(ox + offset,      wy, ox + offset,      wy + 8);
        gfx.lineBetween(ox + offset + 16, wy, ox + offset + 16, wy + 8);
      }
      // NW highlight on top and left of each brick
      gfx.fillStyle(0x5a5a5a, 0.5);
      for (let row = 0; row < 4; row++) {
        const wy     = row * 8;
        const offset = (row % 2) === 0 ? 0 : 16;
        for (let col = 0; col < 2; col++) {
          const bx = ox + offset + col * 16;
          gfx.fillRect(bx + 1, wy + 1, 14, 1); // top highlight
          gfx.fillRect(bx + 1, wy + 1, 1, 6);  // left highlight
        }
      }
      // SE shadow
      gfx.fillStyle(0x1e1e1e, 0.5);
      for (let row = 0; row < 4; row++) {
        const wy     = row * 8;
        const offset = (row % 2) === 0 ? 0 : 16;
        for (let col = 0; col < 2; col++) {
          const bx = ox + offset + col * 16;
          gfx.fillRect(bx + 1, wy + 6, 14, 1); // bottom shadow
        }
      }
      break;
    }

    case 9: { // Damaged Wall — same bricks, cracked
      // Faint mortar
      gfx.lineStyle(1, 0x3a3a3a, 0.5);
      for (let wy = 0; wy < T; wy += 8) {
        gfx.lineBetween(ox, wy, ox + T, wy);
        const offset = ((wy / 8) % 2) === 0 ? 0 : 16;
        gfx.lineBetween(ox + offset,      wy, ox + offset,      wy + 8);
        gfx.lineBetween(ox + offset + 16, wy, ox + offset + 16, wy + 8);
      }
      // Crack lines
      gfx.lineStyle(1, 0x2a2a2a, 0.9);
      gfx.lineBetween(ox + 5,  2, ox + 8,  12);
      gfx.lineBetween(ox + 8,  12, ox + 6,  18);
      gfx.lineBetween(ox + 20, 8, ox + 18, 20);
      gfx.lineBetween(ox + 18, 20, ox + 22, 28);
      gfx.lineBetween(ox + 12, 18, ox + 14, 28);
      break;
    }

    case 10: { // Mountain — multi-level rocky peak, NW top-down lighting
      // Base rock — mid tier
      gfx.fillStyle(0x6e6050);
      gfx.fillRect(ox + 4,  12, 10, 8);
      gfx.fillRect(ox + 12, 8,  8,  12);
      gfx.fillRect(ox + 18, 14, 8,  8);
      gfx.fillRect(ox + 6,  20, 14, 6);
      // Upper tier
      gfx.fillStyle(0x8a7862);
      gfx.fillRect(ox + 8,  8,  6,  6);
      gfx.fillRect(ox + 13, 4,  8,  8);
      gfx.fillRect(ox + 20, 8,  6,  6);
      // Peak highlights (NW light)
      gfx.fillStyle(0xb0a080);
      gfx.fillRect(ox + 13, 4, 5, 2);
      gfx.fillRect(ox + 13, 4, 2, 6);
      gfx.fillRect(ox + 8,  8, 4, 1);
      // SE shadow faces
      gfx.fillStyle(0x1e1610);
      gfx.fillRect(ox + 18, 10, 2, 6);
      gfx.fillRect(ox + 14, 20, 10, 3);
      gfx.fillRect(ox + 6,  24, 14, 3);
      // Scree / rock chips at base
      gfx.fillStyle(0x5a5040, 0.7);
      for (const [dx, dy] of [[3,22],[22,24],[26,18],[2,16],[28,10]]) {
        gfx.fillRect(ox + dx, dy, 2, 2);
      }
      break;
    }
  }
}

/**
 * Draw one of the 16 road variant tiles into the tileset strip.
 * Bitmask bits: 0=N  1=E  2=S  3=W
 * Each tile shows a grass shoulder with a dark asphalt strip and white
 * dashed centre-line segments running toward every connected neighbour.
 */
export function drawRoadVariant(gfx: Phaser.GameObjects.Graphics, ox: number, mask: number) {
  const T  = TILE_SIZE;   // 32
  const SH = 3;           // grass shoulder on unconnected sides
  const cx = ox + T / 2;
  const cy = T / 2;

  const hasN = (mask & 1) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasW = (mask & 8) !== 0;

  // Full asphalt base
  gfx.fillStyle(0x242424);
  gfx.fillRect(ox, 0, T, T);
  // Subtle asphalt grain
  gfx.fillStyle(0x1c1c1c, 0.6);
  for (let gy = 2; gy < T; gy += 6) gfx.fillRect(ox + 2, gy, T - 4, 1);

  // Grass shoulders only on sides with no road neighbour
  gfx.fillStyle(0x3e7a22);
  if (!hasN) gfx.fillRect(ox,          0,      T,  SH);
  if (!hasS) gfx.fillRect(ox,          T - SH, T,  SH);
  if (!hasE) gfx.fillRect(ox + T - SH, 0,      SH, T);
  if (!hasW) gfx.fillRect(ox,          0,      SH, T);

  // White dashed centre lines
  gfx.fillStyle(0xeeeeee);
  const DASH = 4, STRIDE = 7;

  const dashV = (y1: number, y2: number) => {
    for (let y = y1; y < y2; y += STRIDE) {
      gfx.fillRect(cx - 1, y, 2, Math.min(DASH, y2 - y));
    }
  };
  const dashH = (x1: number, x2: number) => {
    for (let x = x1; x < x2; x += STRIDE) {
      gfx.fillRect(x, cy - 1, Math.min(DASH, x2 - x), 2);
    }
  };

  // Vertical line segment(s)
  if      (hasN && hasS) dashV(SH, T - SH);
  else if (hasN)         dashV(SH, cy);
  else if (hasS)         dashV(cy, T - SH);

  // Horizontal line segment(s)
  if      (hasE && hasW) dashH(ox + SH, ox + T - SH);
  else if (hasE)         dashH(cx, ox + T - SH);
  else if (hasW)         dashH(ox + SH, cx);

  // Centre dot for corners, T-junctions, intersections, and dead-ends
  const isStraight = (hasN && hasS && !hasE && !hasW) || (hasE && hasW && !hasN && !hasS);
  if (!isStraight) gfx.fillRect(cx - 2, cy - 2, 4, 4);
}
