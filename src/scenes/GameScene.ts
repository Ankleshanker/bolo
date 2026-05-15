import Phaser from 'phaser';
import { BoloMapParser } from '../map/BoloMapParser';
import { generateTestMap } from '../map/ProceduralMap';
import {
  TILE_SIZE, MAP_SIZE, TILESET_KEY,
  TERRAIN_SPEED, COLLISION_TILES, DisplayTile, ROAD_VARIANT_BASE,
} from '../map/TileTypes';
import { Tank } from '../entities/Tank';
import { BulletManager } from '../entities/Bullet';
import { PillboxManager } from '../entities/Pillbox';
import { Builder } from '../entities/Builder';
import { InputHandler } from '../input/InputHandler';
import { ActionPanel, PANEL_WIDTH } from '../ui/ActionPanel';
import { SettingsPanel, STORAGE_COLOR } from '../ui/SettingsPanel';
import { SoundManager } from '../audio/SoundManager';
import type { MapData } from '../map/MapData';

const WALL_DAMAGE_CHAIN: Record<number, number> = { 8: 9, 9: 6, 6: 3 };

const GAME_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Builder costs (trees)
const COST_ROAD    = 2;
const COST_WALL    = 4;
const COST_PILLBOX = 10;
const TREES_PER_HARVEST = 4;

interface MineMarker {
  tileX: number;
  tileY: number;
  sprite: Phaser.GameObjects.Sprite;
}

export class GameScene extends Phaser.Scene {
  private mapData!: MapData;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private tank!: Tank;
  private keys!: InputHandler;
  private playerBullets!: BulletManager;
  private pillboxBullets!: BulletManager;
  private pillboxes!: PillboxManager;
  private builder!: Builder;
  private actionPanel!: ActionPanel;
  private settingsPanel!: SettingsPanel;
  private mines: MineMarker[] = [];
  private pillPickups: Phaser.GameObjects.Sprite[] = [];

  // Cameras
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private hudPanelObjects: Phaser.GameObjects.GameObject[] = [];

  // Minimap
  private minimapTerrain!: Phaser.GameObjects.Sprite;
  private minimapBlip!: Phaser.GameObjects.Graphics;

  // Sound
  private soundManager!: SoundManager;

  // HUD
  private hudText!: Phaser.GameObjects.Text;
  private resourceText!: Phaser.GameObjects.Text;
  private statBars!: {
    hp:     Phaser.GameObjects.Rectangle;
    shells: Phaser.GameObjects.Rectangle;
    mines:  Phaser.GameObjects.Rectangle;
    trees:  Phaser.GameObjects.Rectangle;
  };

  // Base markers (index-aligned with mapData.bases)
  private baseRects: Phaser.GameObjects.Rectangle[] = [];

  // State
  private dead          = false;
  private respawnTimer  = 0;
  private _sinking      = false;
  private lastBaseTileX = -1;
  private lastBaseTileY = -1;

  // Win condition
  private gameTimer     = GAME_DURATION_MS;
  private gameOver      = false;
  private timerText!:    Phaser.GameObjects.Text;
  private scoreText!:    Phaser.GameObjects.Text;
  private gameOverObjs:  Phaser.GameObjects.GameObject[] = [];
  private initData:      { useProcedural?: boolean; seed?: number } = {};

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: { useProcedural?: boolean; seed?: number }) {
    this.initData     = data ?? {};
    this.gameTimer    = GAME_DURATION_MS;
    this.gameOver     = false;
    this.gameOverObjs = [];
  }

  create() {
    this.mapData       = this.loadMapData();
    this.buildTilemap();
    this.spawnTank();
    this.playerBullets  = new BulletManager(this);
    this.pillboxBullets = new BulletManager(this);
    this.pillboxes      = new PillboxManager(this, this.mapData.pills);
    this.builder        = new Builder(
      this,
      this.groundLayer,
      this.pillboxes.group,
      (wx, wy) => {
        const tx   = Math.floor(wx / TILE_SIZE);
        const ty   = Math.floor(wy / TILE_SIZE);
        const tile = this.mapData.terrain[ty]?.[tx] ?? DisplayTile.Grass;
        return TERRAIN_SPEED[tile] ?? 1.0;
      },
    );
    this.setupCollision();
    this.setupCamera();
    this.keys          = new InputHandler(this);
    this.actionPanel   = new ActionPanel(this);
    this.settingsPanel = new SettingsPanel(this);
    this.buildHUD();
    this.setupUiCamera();
    this.buildMinimap();
    this.soundManager = new SoundManager();
    // AudioContext requires a user gesture; resume on the first interaction
    const resume = () => this.soundManager.resume();
    this.input.once('pointerdown', resume);
    this.input.keyboard!.once('keydown', resume);
    this.setupWorldClick();
    this.buildTimerHUD();
  }

  update(_time: number, delta: number) {
    if (this.gameOver) return;
    if (!this.gameOver) {
      this.gameTimer -= delta;
      if (this.gameTimer <= 0) { this.triggerGameOver(); return; }
    }

    if (this.dead) {
      this.handleRespawn(delta);
      this.updateMinimap();
      this.updateHUD();
      return;
    }

    const tileVal = this.getTileUnderTank();

    if (!this._sinking && tileVal === DisplayTile.Sea) {
      this.startSinking();
    }

    if (!this._sinking) {
      const state        = this.keys.getState();
      const terrainSpeed = TERRAIN_SPEED[tileVal] ?? 1.0;
      this.tank.updateTank(delta, state, terrainSpeed);
      if (state.fire) {
        const shot = this.tank.tryFire(delta);
        if (shot) {
          this.playerBullets.fire(shot.x, shot.y, shot.angle);
          this.soundManager.playGunshot();
        }
      } else {
        this.tank.tickCooldown(delta);
      }
    }
    const inForest = tileVal === DisplayTile.Forest;
    this.tank.sprite.setAlpha(inForest ? 0.65 : 1);

    this.playerBullets.update(delta);
    this.pillboxBullets.update(delta);
    this.clearForestUnderBullets();
    this.pillboxes.update(delta, this.tank.x, this.tank.y, this.pillboxBullets, inForest,
      () => this.soundManager.playPillboxFire());
    this.builder.update(delta);

    this.checkPillPickup();
    this.checkMines();
    this.checkBaseInteraction();
    this.settingsPanel.update(delta);
    this.updateMinimap();
    this.updateHUD();
  }

  // ─── Map ────────────────────────────────────────────────────────────────────

  private loadMapData(): MapData {
    if (this.initData.useProcedural === true) {
      return generateTestMap(this.initData.seed);
    }
    const raw = this.cache.binary.get('mapdata') as ArrayBuffer | null;
    if (raw) {
      try {
        const data = BoloMapParser.parse(raw);
        console.log(`Loaded .bmap — pills:${data.pills.length} bases:${data.bases.length} starts:${data.starts.length}`);
        return data;
      } catch (e) {
        console.error('Failed to parse .bmap:', e);
      }
    }
    return generateTestMap(this.initData.seed);
  }

  private buildTilemap() {
    const map = this.make.tilemap({
      data: this.mapData.terrain,
      tileWidth:  TILE_SIZE,
      tileHeight: TILE_SIZE,
      width:  MAP_SIZE,
      height: MAP_SIZE,
    });
    const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY, TILE_SIZE, TILE_SIZE, 0, 0)!;
    this.groundLayer = map.createLayer(0, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer;
    this.groundLayer.setDepth(0).setCollision(COLLISION_TILES);
    this.initRoadVisuals();
    this.renderMapObjects();
  }

  private renderMapObjects() {
    for (const base of this.mapData.bases) {
      const cx = base.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = base.y * TILE_SIZE + TILE_SIZE / 2;
      const neutral = base.owner === 0xFF;
      const rect = this.add.rectangle(cx, cy, 24, 24, neutral ? 0xffaa00 : this.teamColor()).setDepth(2);
      this.baseRects.push(rect);
      this.add.text(cx, cy, '★', { fontSize: '14px', color: '#000000' })
        .setDepth(3).setOrigin(0.5);
    }
    for (const start of this.mapData.starts) {
      this.add.triangle(
        start.x * TILE_SIZE + TILE_SIZE / 2,
        start.y * TILE_SIZE + TILE_SIZE / 2,
        0, 10, 10, -10, -10, -10,
        0x00ff00,
      ).setDepth(2);
    }
  }

  private setTile(tileX: number, tileY: number, displayTile: number) {
    const wasRoad = this.mapData.terrain[tileY]?.[tileX] === DisplayTile.Road;
    if (this.mapData.terrain[tileY]) this.mapData.terrain[tileY][tileX] = displayTile;

    if (displayTile === DisplayTile.Road) {
      this.updateRoadAndNeighbors(tileX, tileY);
    } else {
      this.groundLayer.putTileAt(displayTile, tileX, tileY);
      if (wasRoad) {
        // Reconnect neighbours that were touching the old road
        this.updateRoadTileVisual(tileX,     tileY - 1);
        this.updateRoadTileVisual(tileX + 1, tileY);
        this.updateRoadTileVisual(tileX,     tileY + 1);
        this.updateRoadTileVisual(tileX - 1, tileY);
      }
    }
  }

  // ─── Road auto-tiling ───────────────────────────────────────────────────────

  private isRoad(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return false;
    return this.mapData.terrain[ty]?.[tx] === DisplayTile.Road;
  }

  private getRoadVariant(tx: number, ty: number): number {
    const n = this.isRoad(tx,     ty - 1) ? 1 : 0;
    const e = this.isRoad(tx + 1, ty)     ? 2 : 0;
    const s = this.isRoad(tx,     ty + 1) ? 4 : 0;
    const w = this.isRoad(tx - 1, ty)     ? 8 : 0;
    return ROAD_VARIANT_BASE + (n | e | s | w);
  }

  private updateRoadTileVisual(tx: number, ty: number) {
    if (!this.isRoad(tx, ty)) return;
    this.groundLayer.putTileAt(this.getRoadVariant(tx, ty), tx, ty);
  }

  private updateRoadAndNeighbors(tx: number, ty: number) {
    this.updateRoadTileVisual(tx,     ty);
    this.updateRoadTileVisual(tx,     ty - 1);
    this.updateRoadTileVisual(tx + 1, ty);
    this.updateRoadTileVisual(tx,     ty + 1);
    this.updateRoadTileVisual(tx - 1, ty);
  }

  private initRoadVisuals() {
    for (let ty = 0; ty < MAP_SIZE; ty++) {
      for (let tx = 0; tx < MAP_SIZE; tx++) {
        if (this.mapData.terrain[ty]?.[tx] === DisplayTile.Road) {
          this.groundLayer.putTileAt(this.getRoadVariant(tx, ty), tx, ty);
        }
      }
    }
  }

  // ─── Tank ───────────────────────────────────────────────────────────────────

  private spawnTank() {
    const start = this.mapData.starts[0];
    const sx = start ? (start.x + 0.5) * TILE_SIZE : MAP_SIZE / 2 * TILE_SIZE;
    const sy = start ? (start.y + 0.5) * TILE_SIZE : MAP_SIZE / 2 * TILE_SIZE;
    this.tank = new Tank(this, sx, sy);
    const storedColor = parseInt(localStorage.getItem(STORAGE_COLOR) ?? '0xffffff', 16);
    this.tank.sprite.setTint(storedColor);
    this.dead = false;
    this.respawnTimer = 0;
  }

  private onTankKilled() {
    this.dead = true;
    this.respawnTimer = 3000;
    this.builder.cancel();
    const { x, y } = this.tank;
    this.time.delayedCall(0, () => this.spawnExplosionAt(x, y));
    this.tank.sprite.setVisible(false);
    this.tank.body.enable = false;
  }

  private startSinking() {
    this._sinking = true;
    this.tank.body.setVelocity(0, 0);
    this.tweens.add({
      targets:  this.tank.sprite,
      scaleX:   0,
      scaleY:   0,
      alpha:    0,
      angle:    this.tank.sprite.angle + 45,
      duration: 900,
      ease:     'Cubic.In',
      onComplete: () => {
        this._sinking = false;
        this.tank.sprite.setScale(1).setAlpha(1);
        this.onTankKilled();
      },
    });
  }

  private handleRespawn(delta: number) {
    this.respawnTimer -= delta;
    if (this.respawnTimer > 0) return;

    const start = this.mapData.starts[0];
    const sx = start ? (start.x + 0.5) * TILE_SIZE : MAP_SIZE / 2 * TILE_SIZE;
    const sy = start ? (start.y + 0.5) * TILE_SIZE : MAP_SIZE / 2 * TILE_SIZE;
    this.tank.sprite.setPosition(sx, sy).setVisible(true).setScale(1).setAlpha(1);
    this.tank.body.enable = true;
    this.tank.body.setVelocity(0, 0);
    this.tank.health = 10;
    this.tank.shells = 200;
    this.tank.alive  = true;
    this.dead = false;
  }

  // ─── Collision ──────────────────────────────────────────────────────────────

  private setupCollision() {
    this.physics.add.collider(this.tank.sprite, this.groundLayer);
    this.physics.add.collider(this.tank.sprite, this.pillboxes.group);

    this.physics.add.collider(
      this.playerBullets.group, this.groundLayer,
      (bullet, tile) => {
        const t = tile as Phaser.Tilemaps.Tile;
        const next = WALL_DAMAGE_CHAIN[t.index];
        if (next !== undefined) this.setTile(t.x, t.y, next);
        this.playerBullets.kill(bullet as Phaser.Physics.Arcade.Sprite);
      },
    );

    this.physics.add.collider(
      this.pillboxBullets.group, this.groundLayer,
      (bullet) => { this.pillboxBullets.kill(bullet as Phaser.Physics.Arcade.Sprite); },
    );

    this.physics.add.overlap(
      this.playerBullets.group,
      this.pillboxes.group,
      (obj1, obj2) => {
        const isB1Bullet = this.playerBullets.group.contains(obj1 as Phaser.GameObjects.GameObject);
        const b    = (isB1Bullet ? obj1 : obj2) as Phaser.Physics.Arcade.Sprite;
        const pill = (isB1Bullet ? obj2 : obj1) as Phaser.Physics.Arcade.Sprite;
        if (!b.active) return;
        this.playerBullets.kill(b);
        const p = this.pillboxes.findBySprite(pill);
        if (p && p.alive) {
          const died = p.takeDamage();
          if (died) {
            const { x, y } = p;
            this.time.delayedCall(0, () => {
              this.spawnExplosionAt(x, y);
              this.pillboxes.removePill(p);
              const pickup = this.add.sprite(x, y, 'pill_neutral')
                .setDepth(4)
                .setScale(0.65)
                .setAlpha(0.9);
              this.pillPickups.push(pickup);
            });
          }
        }
      },
    );

    this.physics.add.overlap(
      this.pillboxBullets.group,
      this.tank.sprite,
      (obj1, obj2) => {
        const b = this.pillboxBullets.group.contains(obj1 as Phaser.GameObjects.GameObject)
          ? obj1 as Phaser.Physics.Arcade.Sprite
          : obj2 as Phaser.Physics.Arcade.Sprite;
        if (!b.active || this.dead) return;
        this.pillboxBullets.kill(b);
        const killed = this.tank.takeDamage();
        if (killed) this.time.delayedCall(0, () => this.onTankKilled());
      },
    );
  }

  // ─── Camera ─────────────────────────────────────────────────────────────────

  private setupCamera() {
    const totalW = MAP_SIZE * TILE_SIZE;
    const totalH = MAP_SIZE * TILE_SIZE;
    const viewW  = this.scale.width - PANEL_WIDTH;
    const viewH  = this.scale.height;
    this.physics.world.setBounds(0, 0, totalW, totalH);
    this.cameras.main
      .setViewport(PANEL_WIDTH, 0, viewW, viewH)
      .startFollow(this.tank.sprite, true, 0.12, 0.12)
      .setZoom(1);
  }

  private setupUiCamera() {
    this.uiCam = this.cameras.add(0, 0, PANEL_WIDTH, this.scale.height);
    this.uiCam.setScroll(0, 0);

    // Main camera does not render panel UI (it would appear offset at canvas x+100)
    this.cameras.main.ignore([
      ...this.actionPanel.gameObjects,
      ...this.settingsPanel.gearObjects,
      ...this.hudPanelObjects,
    ]);
    // uiCam does not render HUD text (depth 30 would show over buttons)
    this.uiCam.ignore([this.hudText, this.resourceText]);

    this.scale.on('resize', (gameSize: { width: number; height: number }) => {
      this.cameras.main.setViewport(PANEL_WIDTH, 0, gameSize.width - PANEL_WIDTH, gameSize.height);
      this.uiCam.setSize(PANEL_WIDTH, gameSize.height);
      this.minimapTerrain?.setPosition(this._minimapObjX(), this._minimapObjY());
    });
  }

  // ─── Builder / Phase 5 ──────────────────────────────────────────────────────

  private setupWorldClick() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < PANEL_WIDTH) return; // action panel area
      if (this.settingsPanel.isOpen) return;
      if (this.builder.isBusy || this.dead) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tileX = Math.floor(world.x / TILE_SIZE);
      const tileY = Math.floor(world.y / TILE_SIZE);
      if (tileX < 0 || tileY < 0 || tileX >= MAP_SIZE || tileY >= MAP_SIZE) return;

      this.tryBuilderAction(tileX, tileY);
    });
  }

  private buildTimerHUD() {
    const style = { fontSize: '14px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 4 } };
    this.timerText = this.add.text(0, 8, '', style).setScrollFactor(0).setDepth(30);
    this.scoreText = this.add.text(0, 32, '', style).setScrollFactor(0).setDepth(30);
    this.repositionTimerHUD();
    this.scale.on('resize', () => this.repositionTimerHUD());
    // uiCam must not render these (created after setupUiCamera, so we add here)
    this.uiCam.ignore([this.timerText, this.scoreText]);
  }

  private repositionTimerHUD() {
    const vw = this.scale.width - PANEL_WIDTH;
    this.timerText.setX(vw - 140);
    this.scoreText.setX(vw - 140);
  }

  private countScore(): { friendly: number; total: number } {
    const friendlyPills = this.pillboxes.pills.filter(p => p.owner === 'friendly').length;
    const friendlyBases = this.mapData.bases.filter(b => b.owner === 0x00).length;
    return {
      friendly: friendlyPills + friendlyBases,
      total: this.mapData.pills.length + this.mapData.bases.length,
    };
  }

  private triggerGameOver() {
    this.gameOver = true;
    const score  = this.countScore();
    const vw     = this.scale.width - PANEL_WIDTH;
    const vh     = this.scale.height;
    const cx     = vw / 2;
    const cy     = vh / 2;
    const D      = 60;

    const push = (obj: Phaser.GameObjects.GameObject) => { this.gameOverObjs.push(obj); return obj; };

    push(this.add.rectangle(cx, cy, vw, vh, 0x000000, 0.78).setScrollFactor(0).setDepth(D).setInteractive());
    push(this.add.text(cx, cy - 80, "TIME'S UP", { fontSize: '40px', color: '#ffdd44', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    push(this.add.text(cx, cy - 20, `Final Score: ${score.friendly} / ${score.total} objectives`, { fontSize: '20px', color: '#ffffff' })
      .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    push(this.add.text(cx, cy + 20, `(${Math.round(score.friendly / score.total * 100)}% map control)`, { fontSize: '14px', color: '#aaaaaa' })
      .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));

    const playAgain = push(this.add.rectangle(cx, cy + 80, 180, 44, 0x1a4a1a)
      .setStrokeStyle(2, 0x44aa44).setScrollFactor(0).setDepth(D + 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('LobbyScene'))
      .on('pointerover', () => (playAgain as Phaser.GameObjects.Rectangle).setFillStyle(0x2a6a2a))
      .on('pointerout',  () => (playAgain as Phaser.GameObjects.Rectangle).setFillStyle(0x1a4a1a)));
    push(this.add.text(cx, cy + 80, 'PLAY AGAIN', { fontSize: '18px', color: '#88ff88', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(D + 2).setOrigin(0.5));
  }

  private tryBuilderAction(tileX: number, tileY: number) {
    const action = this.actionPanel.selectedAction;
    const tile   = this.mapData.terrain[tileY]?.[tileX] ?? 0;
    const t      = this.tank;

    switch (action) {
      case 'collectTrees':
        if (tile !== DisplayTile.Forest) return;
        if (t.trees >= 40) return;
        this.dispatchSoldier(tileX, tileY, () => {
          if (this.mapData.terrain[tileY]?.[tileX] === DisplayTile.Forest) {
            this.setTile(tileX, tileY, DisplayTile.Grass);
            t.trees = Math.min(40, t.trees + TREES_PER_HARVEST);
          }
        });
        break;

      case 'buildRoad':
        if (t.trees < COST_ROAD) return;
        if (tile === DisplayTile.Sea || tile === DisplayTile.Forest) return;
        t.trees -= COST_ROAD;
        this.dispatchSoldier(tileX, tileY, () => this.setTile(tileX, tileY, DisplayTile.Road));
        break;

      case 'buildWall':
        if (t.trees < COST_WALL) return;
        if (tile === DisplayTile.Sea || tile === DisplayTile.Forest) return;
        t.trees -= COST_WALL;
        this.dispatchSoldier(tileX, tileY, () => this.setTile(tileX, tileY, DisplayTile.Wall));
        break;

      case 'buildPillbox':
        if (t.trees < COST_PILLBOX || t.pillsCarried < 1) return;
        if (tile === DisplayTile.Sea || tile === DisplayTile.Wall || tile === DisplayTile.Forest) return;
        t.trees -= COST_PILLBOX;
        t.pillsCarried = 0;
        this.dispatchSoldier(tileX, tileY, () => {
          this.pillboxes.addPill(tileX, tileY);
        });
        break;

      case 'placeMine':
        if (t.mines <= 0) return;
        if (tile === DisplayTile.Sea) return;
        t.mines--;
        this.dispatchSoldier(tileX, tileY, () => {
          const sprite = this.add.sprite(
            (tileX + 0.5) * TILE_SIZE,
            (tileY + 0.5) * TILE_SIZE,
            'mine',
          ).setDepth(1);
          this.mines.push({ tileX, tileY, sprite });
        });
        break;
    }
  }

  private dispatchSoldier(tileX: number, tileY: number, onArrive: () => void) {
    const toX = (tileX + 0.5) * TILE_SIZE;
    const toY = (tileY + 0.5) * TILE_SIZE;
    this.builder.dispatch(toX, toY, () => ({ x: this.tank.x, y: this.tank.y }), () => {
      onArrive();
      this.soundManager.playBuildTile();
    });
  }

  private checkPillPickup() {
    if (this.tank.pillsCarried >= 1) return;
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    for (let i = this.pillPickups.length - 1; i >= 0; i--) {
      const pickup = this.pillPickups[i];
      const ptx = Math.floor(pickup.x / TILE_SIZE);
      const pty = Math.floor(pickup.y / TILE_SIZE);
      if (ptx === tx && pty === ty) {
        this.tank.pillsCarried = 1;
        pickup.destroy();
        this.pillPickups.splice(i, 1);
        break;
      }
    }
  }

  private clearForestUnderBullets() {
    for (const group of [this.playerBullets.group, this.pillboxBullets.group]) {
      for (const obj of group.getChildren()) {
        const b = obj as Phaser.Physics.Arcade.Sprite;
        if (!b.active) continue;
        const tx = Math.floor(b.x / TILE_SIZE);
        const ty = Math.floor(b.y / TILE_SIZE);
        if (this.mapData.terrain[ty]?.[tx] === DisplayTile.Forest) {
          this.setTile(tx, ty, DisplayTile.Grass);
          this.playerBullets.kill(b);
          this.pillboxBullets.kill(b);
        }
      }
    }
  }

  private checkMines() {
    if (this.dead) return;
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (m.tileX === tx && m.tileY === ty) {
        const { x, y } = m.sprite;
        m.sprite.destroy();
        this.mines.splice(i, 1);
        this.spawnExplosionAt(x, y);
        this.setTile(m.tileX, m.tileY, DisplayTile.Crater);
        const killed = this.tank.takeDamage(3);
        if (killed) this.time.delayedCall(0, () => this.onTankKilled());
        break;
      }
    }
  }

  private checkBaseInteraction() {
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    if (tx === this.lastBaseTileX && ty === this.lastBaseTileY) return;

    for (let i = 0; i < this.mapData.bases.length; i++) {
      const base = this.mapData.bases[i];
      if (base.x !== tx || base.y !== ty) continue;

      this.lastBaseTileX = tx;
      this.lastBaseTileY = ty;

      if (base.owner === 0xFF) {
        // Neutral → captured
        base.owner = 0x00;
        this.baseRects[i]?.setFillStyle(this.teamColor());
        this.soundManager.playBuildTile();
      } else if (base.owner === 0x00) {
        // Friendly → resupply
        this.tank.shells = 200;
        this.tank.health = Math.min(10, this.tank.health + 5);
        this.tank.mines  = Math.min(20, this.tank.mines + 5);
      }
      return;
    }
    this.lastBaseTileX = -1;
    this.lastBaseTileY = -1;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private teamColor(): number {
    const stored = localStorage.getItem(STORAGE_COLOR);
    return stored ? parseInt(stored, 16) : 0x44ff44;
  }

  private getTileUnderTank(): number {
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return 0;
    return this.mapData.terrain[ty]?.[tx] ?? 0;
  }

  private spawnExplosionAt(x: number, y: number) {
    const s = this.add.sprite(x, y, 'explosion').setDepth(8);
    this.time.delayedCall(600, () => s.destroy());
    this.soundManager.playExplosion();
  }

  // ─── Minimap ────────────────────────────────────────────────────────────────

  // Terrain fill colors indexed by DisplayTile (matching BootScene TILE_DEFS)
  private static readonly MINIMAP_COLORS: number[] = [
    0x007888, // 0 Sea
    0x009999, // 1 Shallow
    0x050a05, // 2 Swamp
    0x5a3520, // 3 Crater
    0xa08050, // 4 Road
    0x0a1a0a, // 5 Forest
    0x7a6a50, // 6 Rubble
    0x2a4a18, // 7 Grass
    0x4a4a4a, // 8 Wall
    0x6a6a6a, // 9 DamagedWall
    0x5a5040, // 10 Mountain
  ];

  private static readonly MINI = 128;

  private _minimapObjX() {
    return this.scale.width - GameScene.MINI - 4 - PANEL_WIDTH;
  }

  private _minimapObjY() {
    return this.scale.height - GameScene.MINI - 4;
  }

  private buildMinimap() {
    const { MINI, MINIMAP_COLORS } = GameScene;

    // Prerender terrain as a 256×256 texture (1px per tile)
    const gfx = this.make.graphics({ x: 0, y: 0 });
    for (let ty = 0; ty < MAP_SIZE; ty++) {
      for (let tx = 0; tx < MAP_SIZE; tx++) {
        const t   = this.mapData.terrain[ty][tx];
        const col = t < MINIMAP_COLORS.length ? MINIMAP_COLORS[t] : 0x1c1c1c;
        gfx.fillStyle(col);
        gfx.fillRect(tx, ty, 1, 1);
      }
    }
    gfx.generateTexture('minimap_terrain', MAP_SIZE, MAP_SIZE);
    gfx.destroy();

    // Sprite displayed at 0.5 scale → 128×128 on screen
    this.minimapTerrain = this.add.sprite(this._minimapObjX(), this._minimapObjY(), 'minimap_terrain')
      .setScrollFactor(0)
      .setScale(MINI / MAP_SIZE)
      .setOrigin(0, 0)
      .setDepth(90);

    // Blip overlay — cleared and redrawn each frame
    this.minimapBlip = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(91);

    this.uiCam.ignore([this.minimapTerrain, this.minimapBlip]);
  }

  private updateMinimap() {
    const { MINI } = GameScene;
    const W    = MAP_SIZE * TILE_SIZE;
    const objX = this._minimapObjX();
    const objY = this._minimapObjY();

    this.minimapBlip.clear();

    // Pillbox dots
    for (const pill of this.pillboxes.pills) {
      const col = pill.owner === 'friendly' ? 0x44ff44
                : pill.owner === 'enemy'    ? 0xff4444
                                             : 0xaaaaaa;
      const mx = objX + (pill.x / W) * MINI;
      const my = objY + (pill.y / W) * MINI;
      this.minimapBlip.fillStyle(col, 0.9);
      this.minimapBlip.fillRect(mx - 1, my - 1, 2, 2);
    }

    // Base dots
    for (const base of this.mapData.bases) {
      const col = base.owner === 0x00 ? 0x44aaff : 0xffaa00;
      const mx = objX + ((base.x + 0.5) * TILE_SIZE / W) * MINI;
      const my = objY + ((base.y + 0.5) * TILE_SIZE / W) * MINI;
      this.minimapBlip.fillStyle(col, 0.9);
      this.minimapBlip.fillRect(mx - 1, my - 1, 2, 2);
    }

    // Player dot (white, on top)
    if (!this.dead) {
      const px = objX + (this.tank.x / W) * MINI;
      const py = objY + (this.tank.y / W) * MINI;
      this.minimapBlip.fillStyle(0xffffff, 1);
      this.minimapBlip.fillCircle(px, py, 2);
    }

    // Border
    this.minimapBlip.lineStyle(1, 0x777777, 0.9);
    this.minimapBlip.strokeRect(objX, objY, MINI, MINI);
  }

  // ─── HUD ────────────────────────────────────────────────────────────────────

  private buildHUD() {
    const style = {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#00000099',
      padding: { x: 6, y: 4 },
    };

    // x=6: with cameras.main viewport at x=100, renders at canvas x=106 (just right of panel)
    this.hudText = this.add.text(6, 8, '', style)
      .setScrollFactor(0).setDepth(30);

    this.resourceText = this.add.text(6, 60, '', style)
      .setScrollFactor(0).setDepth(30);

    // ── Stat bars — owned by uiCam, no scrollFactor needed ─────────────────
    const ICO   = 16;
    const PAD   = 6;
    const GAP   = 3;
    const BL    = PAD + ICO + GAP;
    const BF    = PANEL_WIDTH - BL - PAD;
    const BAR_H = 8;
    const BAR_START  = 512;
    const BAR_STRIDE = 26;

    const makeBar = (iconKey: string, row: number, color: number) => {
      const cy  = BAR_START + row * BAR_STRIDE;
      const ico = this.add.image(PAD + ICO / 2, cy, iconKey).setDepth(22);
      const bg  = this.add.rectangle(BL + BF / 2, cy, BF, BAR_H, 0x222222).setDepth(22);
      const bar = this.add.rectangle(BL, cy, BF, BAR_H, color).setDepth(23).setOrigin(0, 0.5);
      this.hudPanelObjects.push(ico, bg, bar);
      return bar;
    };

    this.statBars = {
      hp:     makeBar('icon_shield', 0, 0x44cc44),
      shells: makeBar('icon_shell',  1, 0xffdd44),
      mines:  makeBar('mine',        2, 0xcc4433),
      trees:  makeBar('icon_wood',   3, 0x7a5230),
    };
  }

  private readonly TERRAIN_NAMES: Record<number, string> = {
    0: 'Sea', 1: 'Shallow', 2: 'Swamp', 3: 'Crater',
    4: 'Road', 5: 'Forest', 6: 'Rubble', 7: 'Grass',
    8: 'Wall', 9: 'Dmg.Wall',
  };

  private updateHUD() {
    if (this.dead) {
      const secs = Math.ceil(this.respawnTimer / 1000);
      this.hudText.setText(`DESTROYED — respawning in ${secs}s`);
      this.resourceText.setText('');
    } else {
      const tileVal  = this.getTileUnderTank();
      const spd      = Math.round(Math.hypot(this.tank.body.velocity.x, this.tank.body.velocity.y));
      const terrain  = this.TERRAIN_NAMES[tileVal] ?? '?';
      const busy     = this.builder.isBusy ? '  [soldier out]' : '';
      const action   = this.actionPanel.selectedAction;

      const pillLabel = this.tank.pillsCarried > 0 ? '  [pill]' : '';
      this.hudText.setText(
        `Spd: ${spd}  Terrain: ${terrain}\nAction: ${action}${busy}${pillLabel}`,
      );
      this.resourceText.setText('');

      // Resize bars (BF=69, matching buildHUD)
      const BF = 69;
      this.statBars.hp    .setSize(Math.max(0, (this.tank.health / 10)  * BF), 8);
      this.statBars.shells.setSize(Math.max(0, (this.tank.shells / 200) * BF), 8);
      this.statBars.mines .setSize(Math.max(0, (this.tank.mines  / 20)  * BF), 8);
      this.statBars.trees .setSize(Math.max(0, (this.tank.trees  / 40)  * BF), 8);
    }

    // Timer + score (always updated)
    const remaining = Math.max(0, this.gameTimer);
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const score = this.countScore();
    this.timerText.setText(`⏱ ${mins}:${secs.toString().padStart(2, '0')}`);
    this.scoreText.setText(`⚑ ${score.friendly}/${score.total}`);
  }
}
