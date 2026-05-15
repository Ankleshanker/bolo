import Phaser from 'phaser';
import { TILE_SIZE, NUM_DISPLAY_TILES, TILESET_KEY, ROAD_VARIANT_BASE } from '../map/TileTypes';

// Visual definition for each display tile
const TILE_DEFS: { fill: number; border: number; detail?: () => void }[] = [
  { fill: 0x007888, border: 0x007888 },   // 0  Sea          teal base (wave dots by detail)
  { fill: 0x009999, border: 0x009999 },   // 1  Shallow Sea  solid teal
  { fill: 0x050a05, border: 0x050a05 },   // 2  Swamp        near-black (dots by detail)
  { fill: 0x5a3520, border: 0x3a2010 },   // 3  Crater       dark brown
  { fill: 0xa08050, border: 0x7a5f38 },   // 4  Road         sandy tan
  { fill: 0x0a1a0a, border: 0x0a1a0a },   // 5  Forest       dark forest floor
  { fill: 0x7a6a50, border: 0x5a4e38 },   // 6  Rubble       grey-brown
  { fill: 0x2a4a18, border: 0x2a4a18 },   // 7  Grass        medium-dark olive-green base
  { fill: 0x4a4a4a, border: 0x2a2a2a },   // 8  Wall         dark grey
  { fill: 0x6a6a6a, border: 0x4a4a4a },   // 9  Damaged Wall lighter grey
  { fill: 0x5a5040, border: 0x3a3028 },   // 10 Mountain     dark rocky grey-brown
];

function drawTileDetails(gfx: Phaser.GameObjects.Graphics, index: number, x: number) {
  const T = TILE_SIZE;
  const ox = x;

  switch (index) {
    case 0: { // Sea — dark blue dot-waves on teal base (full period = 16 px → tiles seamlessly)
      gfx.fillStyle(0x000099);
      for (let wy = 3; wy < T; wy += 8) {
        for (let wx = 0; wx < T; wx += 5) {
          const yo  = Math.round(Math.sin(wx * Math.PI / 8) * 2);
          const dotY = wy + yo;
          if (dotY >= 0 && dotY + 2 <= T) gfx.fillRect(ox + wx, dotY, 2, 2);
        }
      }
      break;
    }

    case 2: { // Swamp — scattered green and teal 2×2 dots on near-black
      const swampDots: [number, number, number][] = [
        [3, 4, 0x00bb00], [11, 2, 0x00bbaa], [20, 5, 0x00bb00], [27, 3, 0x00aabb],
        [8, 11, 0x00bbaa], [16, 13, 0x00bb00], [25, 10, 0x00bb44], [0, 14, 0x00bbaa],
        [4, 20, 0x00bb00], [13, 21, 0x00bbaa], [22, 18, 0x00bb00], [30, 20, 0x00aabb],
        [7, 28, 0x00bbaa], [17, 26, 0x00bb00], [25, 29, 0x00bb44],
      ];
      for (const [dx, dy, col] of swampDots) {
        gfx.fillStyle(col);
        gfx.fillRect(ox + dx, dy, 2, 2);
      }
      break;
    }

    case 3: // Crater — concentric rings
      gfx.lineStyle(1, 0x3a2010, 0.8);
      gfx.strokeCircle(ox + 16, 16, 10);
      gfx.strokeCircle(ox + 16, 16, 5);
      gfx.fillStyle(0x2a1808, 0.6);
      gfx.fillCircle(ox + 16, 16, 3);
      break;

    case 5: { // Forest — tree canopies viewed from above
      const canopies: [number, number, number][] = [
        [8, 8, 7], [24, 7, 6], [16, 18, 7], [5, 25, 6], [25, 24, 6],
      ];
      for (const [tx, ty, r] of canopies) {
        gfx.fillStyle(0x1a6a1a);
        gfx.fillCircle(ox + tx, ty, r);
        gfx.fillStyle(0x2a8a2a);
        gfx.fillCircle(ox + tx - 1, ty - 1, Math.max(1, r - 2));
        gfx.fillStyle(0x3aaa3a);
        gfx.fillCircle(ox + tx - 2, ty - 2, Math.max(1, r - 4));
      }
      break;
    }

    case 6: // Rubble — random debris squares
      gfx.fillStyle(0x4a4040, 0.7);
      for (const [dx, dy] of [[4, 6], [14, 4], [22, 10], [8, 18], [20, 22], [12, 26]]) {
        gfx.fillRect(ox + dx, dy, 3, 3);
      }
      break;

    case 7: { // Grass — subtle darker and lighter marks on olive base
      const grassMarks: [number, number, number][] = [
        [2, 2, 0x4a8a2a], [10, 3, 0x3a6a1e], [18, 1, 0x4a8a2a], [26, 3, 0x3a6a1e],
        [6, 9, 0x3a6a1e], [14, 8, 0x4a8a2a], [22, 10, 0x3a6a1e], [30, 8, 0x4a8a2a],
        [4, 17, 0x4a8a2a], [12, 16, 0x3a6a1e], [20, 18, 0x4a8a2a], [28, 16, 0x3a6a1e],
        [8, 25, 0x3a6a1e], [16, 24, 0x4a8a2a], [24, 26, 0x3a6a1e], [0, 25, 0x4a8a2a],
      ];
      for (const [gx, gy, col] of grassMarks) {
        gfx.fillStyle(col);
        gfx.fillRect(ox + gx, gy, 2, 2);
      }
      break;
    }

    case 8: // Wall — brick pattern
      gfx.lineStyle(1, 0x2a2a2a, 0.8);
      for (let wy = 0; wy < T; wy += 8) {
        gfx.lineBetween(ox, wy, ox + T, wy);
        const offset = (wy / 8 % 2) === 0 ? 0 : 16;
        gfx.lineBetween(ox + offset, wy, ox + offset, wy + 8);
        gfx.lineBetween(ox + offset + 16, wy, ox + offset + 16, wy + 8);
      }
      break;

    case 10: { // Mountain — top-down rocky peak with NW lighting
      // NW-lit upper rock faces (lighter)
      gfx.fillStyle(0x8a7a68);
      gfx.fillRect(ox + 5,  8, 8, 6);
      gfx.fillRect(ox + 5, 14, 5, 4);
      gfx.fillRect(ox + 13, 4, 6, 5);
      gfx.fillRect(ox + 20, 8, 7, 5);
      // SE shadow faces (very dark)
      gfx.fillStyle(0x2a1e18);
      gfx.fillRect(ox + 6,  18,  5, 5);
      gfx.fillRect(ox + 14, 15,  8, 6);
      gfx.fillRect(ox + 10, 22, 10, 5);
      // Peak highlight
      gfx.fillStyle(0xb8a890);
      gfx.fillRect(ox + 14, 5, 4, 4);
      gfx.fillRect(ox + 7, 12, 3, 3);
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
function drawRoadVariant(gfx: Phaser.GameObjects.Graphics, ox: number, mask: number) {
  const T  = TILE_SIZE;   // 32
  const SH = 3;           // grass shoulder on unconnected sides
  const cx = ox + T / 2;
  const cy = T / 2;

  const hasN = (mask & 1) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasW = (mask & 8) !== 0;

  // Full asphalt base — adjacent tiles share edges seamlessly
  gfx.fillStyle(0x1c1c1c);
  gfx.fillRect(ox, 0, T, T);

  // Grass shoulders only on sides with no road neighbour
  gfx.fillStyle(0x4a8a2a);
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

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // Tileset: horizontal strip of NUM_DISPLAY_TILES tiles, each TILE_SIZE × TILE_SIZE
    const stripWidth = TILE_SIZE * NUM_DISPLAY_TILES;
    const gfx = this.make.graphics({ x: 0, y: 0 });

    for (let i = 0; i < TILE_DEFS.length; i++) {
      const { fill, border } = TILE_DEFS[i];
      const ox = i * TILE_SIZE;

      gfx.fillStyle(fill);
      gfx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);

      drawTileDetails(gfx, i, ox);

      gfx.lineStyle(1, border, 0.5);
      gfx.strokeRect(ox, 0, TILE_SIZE, TILE_SIZE);
    }

    // Road variant tiles 10–25 (bitmask 0–15)
    for (let mask = 0; mask < 16; mask++) {
      drawRoadVariant(gfx, (ROAD_VARIANT_BASE + mask) * TILE_SIZE, mask);
    }

    gfx.generateTexture(TILESET_KEY, stripWidth, TILE_SIZE);
    gfx.destroy();

    // Tank sprite — drawn facing NORTH (up) so angle=0 → tank points up in-game.
    // Treads run vertically (top-to-bottom), barrel points up.
    const tank = this.make.graphics({ x: 0, y: 0 });

    // Left tread
    tank.fillStyle(0x383838);
    tank.fillRect(3, 4, 7, 24);
    // Right tread
    tank.fillRect(22, 4, 7, 24);
    // Tread detail lines
    tank.lineStyle(1, 0x1a1a1a, 0.8);
    for (let ty = 6; ty < 28; ty += 4) {
      tank.lineBetween(3, ty, 10, ty);
      tank.lineBetween(22, ty, 29, ty);
    }

    // Hull body
    tank.fillStyle(0x606060);
    tank.fillRect(10, 6, 12, 20);

    // Turret
    tank.fillStyle(0x4a4a4a);
    tank.fillRect(11, 9, 10, 10);

    // Barrel — points UP (north)
    tank.fillStyle(0x2e2e2e);
    tank.fillRect(14, 2, 4, 12);

    // Highlight
    tank.fillStyle(0x909090, 0.5);
    tank.fillRect(11, 9, 4, 4);

    tank.generateTexture('tank', TILE_SIZE, TILE_SIZE);
    tank.destroy();

    // Soldier — 16×16 top-down figure
    const sol = this.make.graphics({ x: 0, y: 0 });
    sol.fillStyle(0x4a5a2a); // helmet
    sol.fillRect(4, 1, 8, 4);
    sol.fillStyle(0xd4a872); // face
    sol.fillRect(5, 4, 6, 4);
    sol.fillStyle(0x8c7a3a); // torso
    sol.fillRect(4, 8, 8, 5);
    sol.fillStyle(0x4a3a1a); // legs
    sol.fillRect(4, 13, 3, 3);
    sol.fillRect(9, 13, 3, 3);
    sol.fillStyle(0x555555); // rifle
    sol.fillRect(12, 7, 4, 2);
    sol.generateTexture('soldier', 16, 16);
    sol.destroy();

    // Mine — dark circle with prongs (16×16)
    const mine = this.make.graphics({ x: 0, y: 0 });
    mine.fillStyle(0x222222);
    mine.fillCircle(8, 8, 5);
    mine.lineStyle(1, 0x777777);
    mine.lineBetween(8, 2, 8, 5);
    mine.lineBetween(8, 11, 8, 14);
    mine.lineBetween(2, 8, 5, 8);
    mine.lineBetween(11, 8, 14, 8);
    mine.fillStyle(0x888888);
    mine.fillCircle(8, 8, 2);
    mine.generateTexture('mine', 16, 16);
    mine.destroy();

    // Bullet — small yellow/white circle (8×8)
    const bullet = this.make.graphics({ x: 0, y: 0 });
    bullet.fillStyle(0xffee44);
    bullet.fillCircle(4, 4, 3);
    bullet.fillStyle(0xffffff, 0.6);
    bullet.fillCircle(3, 3, 1);
    bullet.generateTexture('bullet', 8, 8);
    bullet.destroy();

    // Helper to draw a pillbox body (barrel points NORTH, 32×32)
    const drawPillbox = (g: Phaser.GameObjects.Graphics, bodyColor: number, rimColor: number) => {
      // Base plate
      g.fillStyle(rimColor);
      g.fillCircle(16, 16, 13);
      // Body
      g.fillStyle(bodyColor);
      g.fillCircle(16, 16, 10);
      // Barrel slot (north)
      g.fillStyle(rimColor);
      g.fillRect(13, 3, 6, 12);
      g.fillStyle(0x111111);
      g.fillRect(14, 4, 4, 10);
      // Vision slit
      g.fillStyle(0x000000, 0.6);
      g.fillRect(11, 13, 10, 3);
    };

    const pillNeutral = this.make.graphics({ x: 0, y: 0 });
    drawPillbox(pillNeutral, 0x888888, 0x555555);
    pillNeutral.generateTexture('pill_neutral', TILE_SIZE, TILE_SIZE);
    pillNeutral.destroy();

    const pillFriendly = this.make.graphics({ x: 0, y: 0 });
    drawPillbox(pillFriendly, 0x3a8c2a, 0x1e5018);
    pillFriendly.generateTexture('pill_friendly', TILE_SIZE, TILE_SIZE);
    pillFriendly.destroy();

    const pillEnemy = this.make.graphics({ x: 0, y: 0 });
    drawPillbox(pillEnemy, 0x9c2a2a, 0x5c1010);
    pillEnemy.generateTexture('pill_enemy', TILE_SIZE, TILE_SIZE);
    pillEnemy.destroy();

    // Explosion — orange/red burst (32×32)
    const explode = this.make.graphics({ x: 0, y: 0 });
    for (let ring = 14; ring >= 4; ring -= 2) {
      const alpha = (14 - ring) / 12;
      const col = ring > 8 ? 0xff6600 : 0xff2200;
      explode.fillStyle(col, 0.9 - alpha * 0.5);
      explode.fillCircle(16, 16, ring);
    }
    explode.fillStyle(0xffee44, 0.9);
    explode.fillCircle(16, 16, 5);
    explode.generateTexture('explosion', TILE_SIZE, TILE_SIZE);
    explode.destroy();

    // Stat-bar icons (16×16) ─────────────────────────────────────────────────

    // Shield → HP
    const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
    const shieldPts = [V(3,2), V(13,2), V(13,9), V(8,14), V(3,9)];
    const shield = this.make.graphics({ x: 0, y: 0 });
    shield.fillStyle(0xbbbbbb);
    shield.fillPoints(shieldPts, true);
    shield.lineStyle(1, 0x666666);
    shield.strokePoints(shieldPts, true);
    shield.fillStyle(0xdddddd);
    shield.fillRect(6, 4, 4, 5);
    shield.generateTexture('icon_shield', 16, 16);
    shield.destroy();

    // Shell → ammo
    const shellIco = this.make.graphics({ x: 0, y: 0 });
    shellIco.fillStyle(0xddaa33);
    shellIco.fillPoints([V(5,6), V(11,6), V(8,1)], true);  // tip
    shellIco.fillStyle(0xcc9922);
    shellIco.fillRect(5, 6, 6, 7);   // casing body
    shellIco.fillStyle(0x997711);
    shellIco.fillRect(4, 13, 8, 2);  // rim
    shellIco.generateTexture('icon_shell', 16, 16);
    shellIco.destroy();

    // Stacked logs → wood/trees
    const woodIco = this.make.graphics({ x: 0, y: 0 });
    woodIco.fillStyle(0x8b5e3c);
    woodIco.fillRect(2, 3, 12, 4);
    woodIco.fillStyle(0xaa7a50);
    woodIco.fillRect(2, 3, 3, 4);    // end grain
    woodIco.lineStyle(1, 0x5a3a1a);
    woodIco.strokeRect(2, 3, 12, 4);
    woodIco.fillStyle(0x8b5e3c);
    woodIco.fillRect(2, 9, 12, 4);
    woodIco.fillStyle(0xaa7a50);
    woodIco.fillRect(2, 9, 3, 4);
    woodIco.lineStyle(1, 0x5a3a1a);
    woodIco.strokeRect(2, 9, 12, 4);
    woodIco.generateTexture('icon_wood', 16, 16);
    woodIco.destroy();

    // Button preview icons (32×32) — reuse existing draw helpers with ox=0
    const icoTrees = this.make.graphics({ x: 0, y: 0 });
    icoTrees.fillStyle(TILE_DEFS[5].fill);
    icoTrees.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    drawTileDetails(icoTrees, 5, 0);
    icoTrees.generateTexture('icon_trees', TILE_SIZE, TILE_SIZE);
    icoTrees.destroy();

    const icoRoad = this.make.graphics({ x: 0, y: 0 });
    drawRoadVariant(icoRoad, 0, 0b1010); // E+W straight road
    icoRoad.generateTexture('icon_road', TILE_SIZE, TILE_SIZE);
    icoRoad.destroy();

    const icoWall = this.make.graphics({ x: 0, y: 0 });
    icoWall.fillStyle(TILE_DEFS[8].fill);
    icoWall.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    drawTileDetails(icoWall, 8, 0);
    icoWall.generateTexture('icon_wall', TILE_SIZE, TILE_SIZE);
    icoWall.destroy();

    // Pillbox damage cracks — radiating lines drawn in near-black (32×32)
    const cracks = this.make.graphics({ x: 0, y: 0 });
    cracks.lineStyle(1, 0x111111, 1.0);
    cracks.fillStyle(0x111111, 1.0);
    cracks.fillCircle(16, 16, 2);          // centre chip
    cracks.lineBetween(16, 16,  6,  7);    // NW long
    cracks.lineBetween( 6,  7,  3,  3);    // NW branch
    cracks.lineBetween(16, 16, 24,  8);    // NE
    cracks.lineBetween(24,  8, 27,  5);
    cracks.lineBetween(16, 16, 26, 22);    // E
    cracks.lineBetween(16, 16,  9, 25);    // SW
    cracks.lineBetween( 9, 25,  6, 29);
    cracks.generateTexture('pill_cracks', TILE_SIZE, TILE_SIZE);
    cracks.destroy();

    // Try to load the test map; GameScene handles load failure gracefully
    this.load.binary('mapdata', '/maps/test.bmap');
    this.load.on('loaderror', (_file: Phaser.Loader.File) => {
      console.warn('test.bmap not found — will use procedural map');
    });
  }

  create() {
    this.scene.start('GameScene');
  }
}
