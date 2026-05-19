import Phaser from 'phaser';
import { TILE_SIZE, NUM_DISPLAY_TILES, TILESET_KEY, ROAD_VARIANT_BASE } from '../map/TileTypes';
import { TILE_DEFS, drawTileDetails, drawRoadVariant } from '../gfx/TileTextures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    this._generateTileset();
    this._generateTankSprite();
    this._generateSoldierSprite();
    this._generateBoatSprite();
    this._generateMineSprite();
    this._generateBulletSprite();
    this._generatePillboxSprites();
    this._generateExplosionSprite();
    this._generateStatBarIcons();
    this._generateActionPanelIcons();
    this._generatePillCracks();
    this._loadMapAssets();
  }

  private _generateTileset() {
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
  }

  private _generateTankSprite() {
    // Tank sprite — facing NORTH (angle=0 → barrel points up)
    const tank = this.make.graphics({ x: 0, y: 0 });

    // Left tread body
    tank.fillStyle(0x2e2e2e);
    tank.fillRect(2, 3, 8, 26);
    // Left tread segments
    tank.fillStyle(0x484848);
    for (let ty = 4; ty < 28; ty += 4) tank.fillRect(2, ty, 8, 2);
    // Left tread highlight edge
    tank.fillStyle(0x555555);
    tank.fillRect(2, 3, 1, 26);

    // Right tread body
    tank.fillStyle(0x2e2e2e);
    tank.fillRect(22, 3, 8, 26);
    tank.fillStyle(0x484848);
    for (let ty = 4; ty < 28; ty += 4) tank.fillRect(22, ty, 8, 2);
    tank.fillStyle(0x555555);
    tank.fillRect(29, 3, 1, 26);

    // Hull body
    tank.fillStyle(0x686868);
    tank.fillRect(10, 5, 12, 22);
    // Hull NW highlight
    tank.fillStyle(0x888888);
    tank.fillRect(10, 5, 12, 1);
    tank.fillRect(10, 5, 1, 22);
    // Hull SE shadow
    tank.fillStyle(0x3a3a3a);
    tank.fillRect(10, 26, 12, 1);
    tank.fillRect(21, 5, 1, 22);

    // Turret base plate
    tank.fillStyle(0x505050);
    tank.fillRect(11, 10, 10, 10);

    // Turret top
    tank.fillStyle(0x5e5e5e);
    tank.fillRect(12, 11, 8, 8);
    tank.fillStyle(0x787878);
    tank.fillRect(12, 11, 8, 1);
    tank.fillRect(12, 11, 1, 8);

    // Barrel — thick at base, narrow at tip
    tank.fillStyle(0x282828);
    tank.fillRect(14, 1, 4, 11);
    tank.fillStyle(0x383838);
    tank.fillRect(15, 1, 2, 11);

    tank.generateTexture('tank', TILE_SIZE, TILE_SIZE);
    tank.destroy();
  }

  private _generateSoldierSprite() {
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
  }

  private _generateBoatSprite() {
    // Boat — 32×32 top-down view; sits on water tiles
    const boat = this.make.graphics({ x: 0, y: 0 });
    // Outer hull rim
    boat.fillStyle(0x083030);
    boat.fillEllipse(16, 16, 30, 30);
    // Hull body
    boat.fillStyle(0x0e4e4e);
    boat.fillEllipse(16, 16, 26, 26);
    // Wooden deck planks
    boat.fillStyle(0x7a5020);
    boat.fillRect(8, 11, 16, 2);
    boat.fillRect(8, 15, 16, 2);
    boat.fillRect(8, 19, 16, 2);
    boat.fillRect(8, 23, 16, 2);
    // Plank highlight edges
    boat.fillStyle(0x9a6830, 0.6);
    boat.fillRect(8, 11, 16, 1);
    boat.fillRect(8, 15, 16, 1);
    boat.fillRect(8, 19, 16, 1);
    boat.fillRect(8, 23, 16, 1);
    // 4 directional arrows (light teal)
    boat.fillStyle(0x88dddd);
    boat.fillTriangle(16, 2,  12, 9,  20, 9);   // North
    boat.fillTriangle(16, 30, 12, 23, 20, 23);  // South
    boat.fillTriangle(30, 16, 23, 12, 23, 20);  // East
    boat.fillTriangle(2,  16, 9,  12, 9,  20);  // West
    boat.generateTexture('boat', TILE_SIZE, TILE_SIZE);
    boat.destroy();
  }

  private _generateMineSprite() {
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
  }

  private _generateBulletSprite() {
    // Bullet — small yellow/white circle (8×8)
    const bullet = this.make.graphics({ x: 0, y: 0 });
    bullet.fillStyle(0xffee44);
    bullet.fillCircle(4, 4, 3);
    bullet.fillStyle(0xffffff, 0.6);
    bullet.fillCircle(3, 3, 1);
    bullet.generateTexture('bullet', 8, 8);
    bullet.destroy();
  }

  private _generatePillboxSprites() {
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
  }

  private _generateExplosionSprite() {
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
  }

  private _generateStatBarIcons() {
    // Stat-bar icons (16×16)

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
    const V2 = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
    shellIco.fillStyle(0xddaa33);
    shellIco.fillPoints([V2(5,6), V2(11,6), V2(8,1)], true);  // tip
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
  }

  private _generateActionPanelIcons() {
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
  }

  private _generatePillCracks() {
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
  }

  private _loadMapAssets() {
    // Try to load the bundled map; GameScene handles load failure gracefully
    this.load.binary('mapdata', `${import.meta.env.BASE_URL}maps/everard-island.bmap`);
    this.load.on('loaderror', (_file: Phaser.Loader.File) => {
      console.warn('everard-island.bmap not found — will use procedural map');
    });
  }

  create() {
    this.scene.start('LobbyScene');
  }
}
