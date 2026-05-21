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
import { MinimapSystem } from '../ui/MinimapSystem';
import { GameOverUI } from '../ui/GameOverUI';
import { SoundManager } from '../audio/SoundManager';
import { Chyron } from '../ui/Chyron';
import { networkManager } from '../network/NetworkManager';
import { GhostTankManager } from '../network/GhostTankManager';
import { BaseManager } from '../entities/BaseManager';
import { MineSystem } from '../entities/MineSystem';
import { MultiplayerBridge } from '../network/MultiplayerBridge';
import type { S2C_GameStart } from '../network/types.ts';
import type { MapData } from '../map/MapData';

const WALL_HIT_THRESHOLDS: Record<number, { hitsNeeded: number; nextTile: number }> = {
  8: { hitsNeeded: 5, nextTile: 9 },
  9: { hitsNeeded: 3, nextTile: 6 },
  6: { hitsNeeded: 2, nextTile: 3 },
};
const GAME_DURATION_MS = 5 * 60 * 1000;

const COST_ROAD    = 2;
const COST_WALL    = 4;
const COST_PILLBOX = 10;
const TREES_PER_HARVEST = 4;


interface GameSceneInitData {
  useProcedural?: boolean;
  seed?: number;
  multiplayerMode?: boolean;
  gameStart?: S2C_GameStart;
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
  private mineSystem!: MineSystem;
  /** SP-only pill pickup sprites; in MP, managed by MultiplayerBridge. */
  private pillPickups: { sprite: Phaser.GameObjects.Sprite; id: string }[] = [];

  // Cameras
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private hudPanelObjects: Phaser.GameObjects.GameObject[] = [];

  // Minimap
  private minimap!: MinimapSystem;

  // Sound
  private soundManager!: SoundManager;

  // HUD
  private hudText!: Phaser.GameObjects.Text;
  private resourceText!: Phaser.GameObjects.Text;
  private hudTextVisible = true;
  private statBars!: {
    hp:     Phaser.GameObjects.Rectangle;
    shells: Phaser.GameObjects.Rectangle;
    mines:  Phaser.GameObjects.Rectangle;
    trees:  Phaser.GameObjects.Rectangle;
  };

  // Base system
  private baseManager!: BaseManager;

  // State
  private dead             = false;
  private respawnTimer     = 0;
  private _sinking         = false;
  private _mineDropTileX = -1;
  private _mineDropTileY = -1;

  // Timer / game over
  private gameTimer    = GAME_DURATION_MS;
  private gameOverUI!: GameOverUI;
  private initData: GameSceneInitData = {};

  // ── Multiplayer ───────────────────────────────────────────────────────────
  private multiplayerMode = false;
  private ghostManager: GhostTankManager | null = null;
  private remoteBullets: BulletManager | null = null;
  private remoteBulletKillZones: Map<string, number> = new Map();
  private mpSendAccum   = 0;     // ms accumulator for 20 Hz send throttle
  private mpGameStart: S2C_GameStart | null = null;
  private chyron!: Chyron;
  private _tankPushCooldowns = new Map<string, number>();
  private mpBridge: MultiplayerBridge | null = null;
  private wallHits = new Map<string, number>();

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: GameSceneInitData) {
    this.initData        = data ?? {};
    this.multiplayerMode = !!(data?.multiplayerMode);
    this.mpGameStart     = data?.gameStart ?? null;
    this.gameTimer       = GAME_DURATION_MS;
    this.mpSendAccum     = 0;
    this._mineDropTileX  = -1;
    this._mineDropTileY  = -1;
    this.wallHits        = new Map();
  }

  create() {
    this.mapData        = this.loadMapData();
    this.soundManager   = new SoundManager();
    // Chyron created early so systems can receive it before buildHUD runs
    this.chyron = new Chyron(this, this.scale.width - PANEL_WIDTH, this.scale.height);
    this.buildTilemap();
    this.spawnTank();
    this.baseManager = new BaseManager(this, this.mapData, this.tank, this.soundManager, this.chyron, this.multiplayerMode);
    this.baseManager.build();
    this.mineSystem = new MineSystem(
      this, this.mapData, this.tank, this.soundManager, this.chyron,
      this.multiplayerMode,
      (tx, ty, dt, bc) => this.setTile(tx, ty, dt, bc),
      (x, y, s) => this.spawnExplosionAt(x, y, s),
      (wx, wy) => this.soundDist(wx, wy),
      () => this.onTankKilled(),
    );
    this.playerBullets  = new BulletManager(this);
    this.pillboxBullets = new BulletManager(this);
    this.pillboxes      = new PillboxManager(this, this.mapData.pills);
    this.builder        = new Builder(
      this, this.groundLayer, this.pillboxes.group,
      (wx, wy) => {
        const tx   = Math.floor(wx / TILE_SIZE);
        const ty   = Math.floor(wy / TILE_SIZE);
        const tile = this.mapData.terrain[ty]?.[tx] ?? DisplayTile.Grass;
        return TERRAIN_SPEED[tile] ?? 1.0;
      },
    );

    if (this.multiplayerMode) {
      this.ghostManager  = new GhostTankManager(this);
      this.remoteBullets = new BulletManager(this);
    }

    this.setupCamera();
    this.keys          = new InputHandler(this);
    this.actionPanel   = new ActionPanel(this);
    this.settingsPanel = new SettingsPanel(this);
    this.buildHUD();

    this.setupCollision();
    this.setupUiCamera();
    this.minimap = new MinimapSystem(this, this.mapData, this.pillboxes, this.ghostManager);
    this.minimap.build();
    this.uiCam.ignore(this.minimap.objects);

    const resume = () => this.soundManager.resume();
    this.input.once('pointerdown', resume);
    this.input.keyboard!.once('keydown', resume);

    this.gameOverUI = new GameOverUI(this, this.uiCam, this.pillboxes, this.mapData, this.soundManager);
    this.gameOverUI.build();
    this.setupWorldClick();

    if (this.multiplayerMode) {
      this.setupMultiplayer();
    }
  }

  update(_time: number, delta: number) {
    if (this.gameOverUI.isGameOver) return;

    // Timer (SP only — MP timer driven by server timeUpdate events)
    if (!this.multiplayerMode) {
      this.gameTimer -= delta;
      if (this.gameTimer <= 0) {
        if (!this.dead) { this.tank.body.setVelocity(0, 0); this.tank.body.enable = false; }
        this.gameOverUI.triggerSP();
        return;
      }
    }

    // Spectator camera (MP only)
    if (this.multiplayerMode && this.dead && (this.mpBridge?.spectatorMode ?? false)) {
      this.mpBridge!.updateSpectator();
    }

    this.chyron.update(delta);

    if (this.dead) {
      this._mineDropTileX = -1;
      this._mineDropTileY = -1;
      this.handleRespawn(delta);
      this.minimap.update(this.tank.x, this.tank.y, this.dead, (this.mpBridge?.spectatorMode ?? false), this.multiplayerMode);
      this.updateHUD();
      return;
    }

    const tileVal = this.getTileUnderTank();
    this.mineSystem.update(this.dead);

    if (!this._sinking && !this.mineSystem.inBoat && tileVal === DisplayTile.Sea) {
      this.startSinking();
    }

    if (!this._sinking) {
      const state = this.keys.getState();
      const onWater = tileVal === DisplayTile.Sea || tileVal === DisplayTile.Shallow;
      const terrainSpeed = (this.mineSystem.inBoat && onWater) ? 1.0 : (TERRAIN_SPEED[tileVal] ?? 1.0);
      this.tank.updateTank(delta, state, terrainSpeed);

      // SHIFT mine-drop: lay a mine on the tile just vacated when moving
      const cx = this.tank.tileX;
      const cy = this.tank.tileY;
      if (this._mineDropTileX !== -1 && (cx !== this._mineDropTileX || cy !== this._mineDropTileY)) {
        if (state.layMine) {
          this.mineSystem.placeMine(this._mineDropTileX, this._mineDropTileY);
        }
      }
      this._mineDropTileX = cx;
      this._mineDropTileY = cy;

      if (state.fire) {
        const shot = this.tank.tryFire(delta);
        if (shot) {
          this.playerBullets.fire(shot.x, shot.y, shot.angle);
          this.soundManager.playGunshot();
          if (this.multiplayerMode) {
            networkManager.sendBulletFired(shot.x, shot.y, shot.angle);
          }
        }
      } else {
        this.tank.tickCooldown(delta);
      }
    }

    const inForest = tileVal === DisplayTile.Forest;
    this.tank.sprite.setAlpha(inForest ? 0.65 : 1);

    this.playerBullets.update(delta);
    this.pillboxBullets.update(delta);
    this.remoteBullets?.update(delta);
    this.clearForestUnderBullets();

    // Update ghost positions BEFORE pillbox AI so the host's target list is current
    this.ghostManager?.update();

    if (this.multiplayerMode) {
      if (networkManager.isHost) {
        // Host is authoritative: build target list from ALL alive players and run AI
        const pillTargets: { x: number; y: number; hidden: boolean; playerId: string }[] = [];
        if (!this.dead) pillTargets.push({ x: this.tank.x, y: this.tank.y, hidden: inForest, playerId: networkManager.playerId });
        for (const t of (this.ghostManager?.getAlivePillTargets() ?? [])) pillTargets.push(t);
        this.pillboxes.update(delta, pillTargets, this.pillboxBullets,
          (pillIdx, px, py, ang) => {
            this.soundManager.playPillboxFire(this.soundDist(px, py));
            networkManager.sendPillboxBulletFired(pillIdx, px, py, ang);
          });
      } else {
        // Non-host: run AI for visual rotation only (no bullets — host broadcasts shots)
        this.pillboxes.update(delta,
          [{ x: this.tank.x, y: this.tank.y, hidden: inForest }],
          null);
      }
    } else {
      // Single-player: normal AI
      this.pillboxes.update(delta,
        [{ x: this.tank.x, y: this.tank.y, hidden: inForest }],
        this.pillboxBullets,
        (_idx, px, py) => this.soundManager.playPillboxFire(this.soundDist(px, py)));
    }

    this.builder.update(delta);

    this.checkPillPickup();
    this.baseManager.update(delta, this.dead);
    this.settingsPanel.update(delta);
    this.minimap.update(this.tank.x, this.tank.y, this.dead, (this.mpBridge?.spectatorMode ?? false), this.multiplayerMode);
    this.updateHUD();

    // 20 Hz state send
    if (this.multiplayerMode) {
      this.mpSendAccum += delta;
      if (this.mpSendAccum >= 50) {
        this.mpSendAccum = 0;
        networkManager.sendTankState({
          x:        this.tank.x,
          y:        this.tank.y,
          angle:    this.tank.angle,
          alive:    this.tank.alive,
          inForest: inForest,
          inBoat:   this.mineSystem.inBoat,
          health:   this.tank.health,
          shells:   this.tank.shells,
          mines:    this.tank.mines,
          trees:    this.tank.trees,
        });
        networkManager.sendSoldierState(
          this.builder.x, this.builder.y, this.builder.isBusy,
        );
      }
    }
  }

  shutdown() {
    this.mpBridge?.shutdown();
    this.ghostManager?.clear();
  }

  // ─── Multiplayer setup ───────────────────────────────────────────────────

  private setupMultiplayer(): void {
    this.mpBridge = new MultiplayerBridge({
      scene:              this,
      tank:               this.tank,
      mapData:            this.mapData,
      pillboxes:          this.pillboxes,
      baseManager:        this.baseManager,
      mineSystem:         this.mineSystem,
      ghostManager:       this.ghostManager!,
      remoteBullets:      this.remoteBullets!,
      playerBullets:      this.playerBullets,
      pillboxBullets:     this.pillboxBullets,
      chyron:             this.chyron,
      soundManager:       this.soundManager,
      gameOverUI:         this.gameOverUI,
      uiCam:              this.uiCam,
      mpGameStart:        this.mpGameStart,
      isDead:             () => this.dead,
      setTile:            (tx, ty, dt, bc) => this.setTile(tx, ty, dt, bc),
      spawnExplosionAt:   (x, y, s) => this.spawnExplosionAt(x, y, s),
      soundDist:          (wx, wy) => this.soundDist(wx, wy),
      onTankKilled:       () => this.onTankKilled(),
      onTimerUpdate:      (r) => { this.gameTimer = r; },
      onRemoteForestChanged: (key, expiry) => { this.remoteBulletKillZones.set(key, expiry); },
      applyWallHit:          (tx, ty) => this.hitWall(tx, ty),
    });
    this.mpBridge.setup();
  }

  // ─── Map ──────────────────────────────────────────────────────────────────

  private loadMapData(): MapData {
    if (this.multiplayerMode && this.mpGameStart) {
      const gs = this.mpGameStart;
      const inlineData = gs.settings?.mapData;
      if (inlineData) {
        try {
          const binary = atob(inlineData);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const data = BoloMapParser.parse(bytes.buffer as ArrayBuffer);
          console.log(`Loaded inline .bmap — pills:${data.pills.length} bases:${data.bases.length}`);
          return data;
        } catch (e) {
          console.error('Failed to parse inline map data:', e);
        }
      }
      if (gs.mapType === 'bmap') {
        const raw = this.cache.binary.get('mapdata') as ArrayBuffer | null;
        if (raw) {
          try { return BoloMapParser.parse(raw); } catch { /* fall through */ }
        }
      }
      return generateTestMap(gs.seed);
    }
    if (this.initData.useProcedural === true || this.initData.useProcedural === undefined) {
      return generateTestMap(this.initData.seed);
    }
    const raw = this.cache.binary.get('mapdata') as ArrayBuffer | null;
    if (raw) {
      try {
        const data = BoloMapParser.parse(raw);
        console.log(`Loaded .bmap — pills:${data.pills.length} bases:${data.bases.length}`);
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
      tileWidth: TILE_SIZE, tileHeight: TILE_SIZE,
      width: MAP_SIZE, height: MAP_SIZE,
    });
    const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY, TILE_SIZE, TILE_SIZE, 0, 0)!;
    this.groundLayer = map.createLayer(0, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer;
    this.groundLayer.setDepth(0).setCollision(COLLISION_TILES);
    this.initRoadVisuals();
  }

  private setTile(tileX: number, tileY: number, displayTile: number, broadcast = true) {
    this.wallHits.delete(`${tileX},${tileY}`);
    const wasRoad = this.mapData.terrain[tileY]?.[tileX] === DisplayTile.Road;
    if (this.mapData.terrain[tileY]) this.mapData.terrain[tileY][tileX] = displayTile;

    if (displayTile === DisplayTile.Road) {
      this.updateRoadAndNeighbors(tileX, tileY);
    } else {
      this.groundLayer.putTileAt(displayTile, tileX, tileY);
      if (wasRoad) {
        this.updateRoadTileVisual(tileX,     tileY - 1);
        this.updateRoadTileVisual(tileX + 1, tileY);
        this.updateRoadTileVisual(tileX,     tileY + 1);
        this.updateRoadTileVisual(tileX - 1, tileY);
      }
    }

    if (this.multiplayerMode && broadcast) {
      networkManager.sendTileChanged(tileX, tileY, displayTile);
    }
  }

  private hitWall(tileX: number, tileY: number): void {
    const tile = this.mapData.terrain[tileY]?.[tileX];
    const threshold = WALL_HIT_THRESHOLDS[tile];
    if (threshold === undefined) return;
    const key = `${tileX},${tileY}`;
    const hits = (this.wallHits.get(key) ?? 0) + 1;
    if (hits >= threshold.hitsNeeded) {
      this.wallHits.delete(key);
      this.setTile(tileX, tileY, threshold.nextTile);
    } else {
      this.wallHits.set(key, hits);
      if (this.multiplayerMode) networkManager.sendWallHit(tileX, tileY);
    }
  }

  // ─── Road auto-tiling ─────────────────────────────────────────────────────

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

  // ─── Tank ─────────────────────────────────────────────────────────────────

  private spawnTank() {
    // In MP, use team assignment from server for spawn point selection
    let start = this.mapData.starts[Math.floor(Math.random() * this.mapData.starts.length)];
    if (this.multiplayerMode && this.mpGameStart) {
      const myTeam = networkManager.myTeamIndex;
      const teamStarts = this.mapData.starts.filter((_, i) => i % (this.mpGameStart!.players.length || 1) === myTeam);
      if (teamStarts.length > 0) start = teamStarts[Math.floor(Math.random() * teamStarts.length)];
    }
    const stx = start ? start.x : Math.floor(MAP_SIZE / 2);
    const sty = start ? start.y : Math.floor(MAP_SIZE / 2);
    const sx  = (stx + 0.5) * TILE_SIZE;
    const sy  = (sty + 0.5) * TILE_SIZE;
    this.tank = new Tank(this, sx, sy);
    const storedColor = parseInt(localStorage.getItem(STORAGE_COLOR) ?? '0xffffff', 16);
    this.tank.sprite.setTint(storedColor);
    this.dead = false;
    this.respawnTimer = 0;
    const spawnTile = this.mapData.terrain[sty]?.[stx] ?? DisplayTile.Sea;
    if (spawnTile === DisplayTile.Sea || spawnTile === DisplayTile.Shallow) {
      this.mineSystem.ensureBoat(stx, sty);
    }
  }

  private onTankKilled() {
    this.dead = true;
    this.respawnTimer = 3000;
    this.builder.cancel();
    const { x, y } = this.tank;
    this.time.delayedCall(0, () => this.spawnExplosionAt(x, y));
    this.tank.sprite.setVisible(false);
    this.tank.body.enable = false;

    // In MP: enter spectator mode while waiting to respawn
    if (this.multiplayerMode) {
      this.mpBridge?.enterSpectatorMode();
      // Send dead state to server
      networkManager.sendTankState({
        x: this.tank.x, y: this.tank.y, angle: this.tank.angle,
        alive: false, inForest: false, inBoat: false,
        health: 0, shells: this.tank.shells, mines: this.tank.mines, trees: this.tank.trees,
      });
    }
  }

  private startSinking() {
    this._sinking = true;
    this.tank.body.setVelocity(0, 0);
    this.soundManager.playTankSinking();
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
        this.chyron.push('You drowned.');
        this.onTankKilled();
      },
    });
  }

  private handleRespawn(delta: number) {
    this.respawnTimer -= delta;
    if (this.respawnTimer > 0) return;

    const start = this.mapData.starts[Math.floor(Math.random() * this.mapData.starts.length)];
    const stx = start ? start.x : Math.floor(MAP_SIZE / 2);
    const sty = start ? start.y : Math.floor(MAP_SIZE / 2);
    const sx  = (stx + 0.5) * TILE_SIZE;
    const sy  = (sty + 0.5) * TILE_SIZE;
    const respawnTile = this.mapData.terrain[sty]?.[stx] ?? DisplayTile.Sea;
    if (respawnTile === DisplayTile.Sea || respawnTile === DisplayTile.Shallow) {
      this.mineSystem.ensureBoat(stx, sty);
    }
    this.tank.sprite.setPosition(sx, sy).setVisible(true).setScale(1).setAlpha(1);
    this.tank.body.enable = true;
    this.tank.body.setVelocity(0, 0);
    this.tank.health = 10;
    this.tank.shells = 200;
    this.tank.alive  = true;
    this.dead = false;
    this.soundManager.playTankRespawn();

    if (this.multiplayerMode) {
      this.mpBridge?.exitSpectatorMode();
      this.gameOverUI.spectatorText.setVisible(false);
      this.cameras.main.startFollow(this.tank.sprite, true, 0.12, 0.12);
    }
  }

  // ─── Collision ────────────────────────────────────────────────────────────

  private setupCollision() {
    this.physics.add.collider(this.tank.sprite, this.groundLayer);
    this.physics.add.collider(this.tank.sprite, this.pillboxes.group);

    this.physics.add.collider(
      this.playerBullets.group, this.groundLayer,
      (bullet, tile) => {
        const t = tile as Phaser.Tilemaps.Tile;
        this.hitWall(t.x, t.y);
        this.playerBullets.kill(bullet as Phaser.Physics.Arcade.Sprite);
        this.soundManager.playHitBuilding(this.soundDist((t.x + 0.5) * TILE_SIZE, (t.y + 0.5) * TILE_SIZE));
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
          if (this.multiplayerMode) {
            const idx = this.pillboxes.pills.indexOf(p);
            networkManager.sendPillboxUpdate(idx, died ? null : networkManager.playerId, p.health, !died);
          }
          if (died) {
            this.chyron.push('A pillbox was destroyed.');
            const { x, y } = p;
            this.time.delayedCall(0, () => {
              this.spawnExplosionAt(x, y);
              this.pillboxes.removePill(p);
              if (this.multiplayerMode) {
                // In MP, destroy the sprite immediately — the host broadcasts pillPickupSpawned
                // and the bridge will recreate the pickup sprite on all clients
                const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                networkManager.sendPillPickupSpawned(id, x, y);
              } else {
                const pickup = this.add.sprite(x, y, 'pill_neutral')
                  .setDepth(4).setScale(0.65).setAlpha(0.9);
                this.pillPickups.push({ sprite: pickup, id: '' });
              }
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
        this.soundManager.playHitTank();
        const killed = this.tank.takeDamage();
        if (killed) this.time.delayedCall(0, () => this.onTankKilled());
      },
    );

    // Player bullets damage enemy/neutral bases
    this.baseManager.setupCollision(this.playerBullets.group);

    // MP-only colliders
    if (this.multiplayerMode && this.ghostManager) {
      // Phase 2–3: local tank cannot pass through remote tanks.
      // Ghosts are immovable (server-authoritative position); all separation
      // energy is applied to the local tank.  The callback adds an extra impulse
      // scaled by the ghost's speed so a fast-moving ghost pushes harder, and
      // sends a network push to the ghost's client when we are the faster tank.
      const PUSH_SCALE         = 0.35;
      const TANK_PUSH_COOLDOWN = 100; // ms between network push events per ghost

      this.physics.add.collider(
        this.tank.sprite,
        this.ghostManager.group,
        (_tankSprite, ghostSprite) => {
          if (this.dead) return;
          const ghost = ghostSprite as Phaser.Physics.Arcade.Sprite;
          const targetId = this.ghostManager!.getPlayerIdBySprite(ghost);
          if (!targetId) return;

          const ghostVel   = this.ghostManager!.getGhostVelocity(ghost);
          const ghostSpeed = Math.hypot(ghostVel.vx, ghostVel.vy);
          const tankSpeed  = Math.hypot(this.tank.body.velocity.x, this.tank.body.velocity.y);

          // Collision normal: direction from ghost toward local tank
          const nx   = this.tank.x - ghost.x;
          const ny   = this.tank.y - ghost.y;
          const nlen = Math.hypot(nx, ny) || 1;
          const nnx  = nx / nlen;
          const nny  = ny / nlen;

          // If the ghost is moving, apply an extra push to the local tank
          if (ghostSpeed > 10) {
            const boost = ghostSpeed * PUSH_SCALE;
            this.tank.body.velocity.x += nnx * boost;
            this.tank.body.velocity.y += nny * boost;
          }

          // If the local tank is faster, push the ghost's client over the network
          const now      = Date.now();
          const lastPush = this._tankPushCooldowns.get(targetId) ?? 0;
          if (tankSpeed > ghostSpeed + 20 && now - lastPush > TANK_PUSH_COOLDOWN) {
            const excess   = tankSpeed - ghostSpeed;
            // Push direction for the ghost: away from the local tank (opposite of nnx)
            networkManager.sendTankPush(targetId, -nnx * excess * PUSH_SCALE, -nny * excess * PUSH_SCALE);
            this._tankPushCooldowns.set(targetId, now);
          }

        },
      );

      // My bullets hit remote players
      this.physics.add.overlap(
        this.playerBullets.group,
        this.ghostManager.group,
        (obj1, obj2) => {
          const isBullet = this.playerBullets.group.contains(obj1 as Phaser.GameObjects.GameObject);
          const bullet   = (isBullet ? obj1 : obj2) as Phaser.Physics.Arcade.Sprite;
          const ghost    = (isBullet ? obj2 : obj1) as Phaser.Physics.Arcade.Sprite;
          if (!bullet.active) return;
          const targetId = this.ghostManager!.getPlayerIdBySprite(ghost);
          if (!targetId) return;
          // Friendly-fire check
          if (!networkManager.settings?.friendlyFire && networkManager.isMyTeam(targetId)) return;
          this.playerBullets.kill(bullet);
          this.soundManager.playHitTank(this.soundDist(ghost.x, ghost.y));
          networkManager.sendBulletHit(targetId, 1);
        },
      );

      // Remote bullets stop on terrain (no tile damage)
      this.physics.add.collider(
        this.remoteBullets!.group,
        this.groundLayer,
        (bullet) => { this.remoteBullets!.kill(bullet as Phaser.Physics.Arcade.Sprite); },
      );

      // Phase 2: pillbox bullets visually stop when they reach a ghost sprite.
      // Damage is handled via the existing pillboxBullets vs tank.sprite overlap
      // on each client's own machine — no additional damage logic needed here.
      this.physics.add.overlap(
        this.pillboxBullets.group,
        this.ghostManager.group,
        (obj1, obj2) => {
          const bullet = this.pillboxBullets.group.contains(obj1 as Phaser.GameObjects.GameObject)
            ? obj1 as Phaser.Physics.Arcade.Sprite
            : obj2 as Phaser.Physics.Arcade.Sprite;
          if (!bullet.active) return;
          this.pillboxBullets.kill(bullet);
        },
      );
    }
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

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

    this.cameras.main.ignore([
      ...this.actionPanel.gameObjects,
      ...this.settingsPanel.gearObjects,
      ...this.hudPanelObjects,
    ]);
    this.uiCam.ignore([this.hudText, this.resourceText, ...this.chyron.getObjects()]);

    this.scale.on('resize', (gameSize: { width: number; height: number }) => {
      this.cameras.main.setViewport(PANEL_WIDTH, 0, gameSize.width - PANEL_WIDTH, gameSize.height);
      this.uiCam.setSize(PANEL_WIDTH, gameSize.height);
      this.minimap.onResize();
      this.chyron.onResize(gameSize.width - PANEL_WIDTH, gameSize.height);
    });
  }

  // ─── Builder / Phase 5 ────────────────────────────────────────────────────

  private setupWorldClick() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < PANEL_WIDTH) return;
      if (this.settingsPanel.isOpen) return;
      if (this.builder.isBusy || this.dead) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const tileX = Math.floor(world.x / TILE_SIZE);
      const tileY = Math.floor(world.y / TILE_SIZE);
      if (tileX < 0 || tileY < 0 || tileX >= MAP_SIZE || tileY >= MAP_SIZE) return;

      this.tryBuilderAction(tileX, tileY);
    });
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
        }, (dist) => this.soundManager.playChopTree(dist));
        break;

      case 'buildRoad':
        if (t.trees < COST_ROAD) return;
        if (tile === DisplayTile.Sea || tile === DisplayTile.Forest) return;
        t.trees -= COST_ROAD;
        this.dispatchSoldier(tileX, tileY, () => this.setTile(tileX, tileY, DisplayTile.Road));
        break;

      case 'buildWall':
        if (t.trees < COST_WALL) return;
        if (tile === DisplayTile.Forest) return;
        t.trees -= COST_WALL;
        if (tile === DisplayTile.Sea || tile === DisplayTile.Shallow) {
          this.dispatchSoldier(tileX, tileY, () => {
            this.mineSystem.ensureBoat(tileX, tileY);
            if (this.multiplayerMode) networkManager.sendBoatAdded(tileX, tileY);
          });
        } else {
          this.dispatchSoldier(tileX, tileY, () => this.setTile(tileX, tileY, DisplayTile.Wall));
        }
        break;

      case 'buildPillbox':
        if (t.trees < COST_PILLBOX || t.pillsCarried < 1) return;
        if (tile === DisplayTile.Sea || tile === DisplayTile.Wall || tile === DisplayTile.Forest) return;
        t.trees -= COST_PILLBOX;
        t.pillsCarried = 0;
        this.dispatchSoldier(tileX, tileY, () => {
          const pill = this.pillboxes.addPill(tileX, tileY, networkManager.playerId);
          if (this.multiplayerMode) {
            const idx = this.pillboxes.pills.indexOf(pill);
            networkManager.sendPillboxUpdate(idx, networkManager.playerId, 4, true, tileX, tileY);
          }
        });
        break;

      case 'placeMine':
        if (t.mines <= 0) return;
        if (tile === DisplayTile.Sea) return;
        t.mines--;
        this.dispatchSoldier(tileX, tileY, () => {
          this.mineSystem.spawnMineSprite(tileX, tileY);
          if (this.multiplayerMode) networkManager.sendMineAdded(tileX, tileY);
        }, (dist) => this.soundManager.playLayMine(dist));
        break;
    }
  }

  private dispatchSoldier(tileX: number, tileY: number, onArrive: () => void, sound?: (dist: number) => void) {
    const toX = (tileX + 0.5) * TILE_SIZE;
    const toY = (tileY + 0.5) * TILE_SIZE;
    this.builder.dispatch(toX, toY, () => ({ x: this.tank.x, y: this.tank.y }), () => {
      onArrive();
      const dist = this.soundDist(toX, toY);
      (sound ?? ((d) => this.soundManager.playBuildTile(d)))(dist);
    });
  }

  private checkPillPickup() {
    if (this.multiplayerMode) {
      // In MP, pill pickups are managed by the bridge
      this.mpBridge?.checkPillPickup();
      return;
    }
    // SP: local pill pickup
    if (this.tank.pillsCarried >= 1) return;
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    for (let i = this.pillPickups.length - 1; i >= 0; i--) {
      const { sprite } = this.pillPickups[i];
      const ptx = Math.floor(sprite.x / TILE_SIZE);
      const pty = Math.floor(sprite.y / TILE_SIZE);
      if (ptx === tx && pty === ty) {
        this.tank.pillsCarried = 1;
        this.soundManager.playPillPickup();
        sprite.destroy();
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
          this.soundManager.playHitTree(this.soundDist(b.x, b.y));
          this.playerBullets.kill(b);
          this.pillboxBullets.kill(b);
        }
      }
    }
    if (this.remoteBullets) {
      const now = Date.now();
      for (const [key, expiry] of this.remoteBulletKillZones) {
        if (expiry <= now) this.remoteBulletKillZones.delete(key);
      }
      for (const obj of this.remoteBullets.group.getChildren()) {
        const b = obj as Phaser.Physics.Arcade.Sprite;
        if (!b.active) continue;
        const tx = Math.floor(b.x / TILE_SIZE);
        const ty = Math.floor(b.y / TILE_SIZE);
        const key = `${tx},${ty}`;
        const inKillZone = this.remoteBulletKillZones.has(key);
        if (this.mapData.terrain[ty]?.[tx] === DisplayTile.Forest || inKillZone) {
          if (inKillZone) this.remoteBulletKillZones.delete(key);
          if (this.mapData.terrain[ty]?.[tx] === DisplayTile.Forest) {
            this.setTile(tx, ty, DisplayTile.Grass, false);
          }
          this.soundManager.playHitTree(this.soundDist(b.x, b.y));
          this.remoteBullets.kill(b);
        }
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private getTileUnderTank(): number {
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return 0;
    return this.mapData.terrain[ty]?.[tx] ?? 0;
  }

  private spawnExplosionAt(x: number, y: number, skipSound = false) {
    const s = this.add.sprite(x, y, 'explosion').setDepth(8);
    this.time.delayedCall(600, () => s.destroy());
    if (!skipSound) this.soundManager.playExplosion(this.soundDist(x, y));
  }

  private soundDist(wx: number, wy: number): number {
    const MAX_HEAR = 640;
    return Math.min(1, Math.hypot(wx - this.tank.x, wy - this.tank.y) / MAX_HEAR);
  }

  // ─── HUD ──────────────────────────────────────────────────────────────────

  private buildHUD() {
    const style = {
      fontSize: '12px', color: '#ffffff',
      backgroundColor: '#00000099', padding: { x: 6, y: 4 },
    };
    this.hudText      = this.add.text(6, 8, '', style).setScrollFactor(0).setDepth(30);
    this.resourceText = this.add.text(6, 60, '', style).setScrollFactor(0).setDepth(30);

    const ICO  = 16; const PAD = 6; const GAP = 3;
    const BL   = PAD + ICO + GAP;
    const BF   = PANEL_WIDTH - BL - PAD;
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

    this.input.keyboard!.on('keydown-BACKTICK', () => {
      this.hudTextVisible = !this.hudTextVisible;
      if (!this.dead) this.hudText.setVisible(this.hudTextVisible);
    });
  }

  private readonly TERRAIN_NAMES: Record<number, string> = {
    0: 'Sea', 1: 'Shallow', 2: 'Swamp', 3: 'Crater',
    4: 'Road', 5: 'Forest', 6: 'Rubble', 7: 'Grass',
    8: 'Wall', 9: 'Dmg.Wall',
  };

  private updateHUD() {
    if (this.dead) {
      const secs = Math.ceil(this.respawnTimer / 1000);
      const label = this.multiplayerMode && (this.mpBridge?.spectatorMode ?? false)
        ? `DESTROYED — respawning in ${secs}s  (Q/E to cycle views)`
        : `DESTROYED — respawning in ${secs}s`;
      this.hudText.setText(label).setVisible(true);
      this.resourceText.setText('');
    } else {
      const tileVal  = this.getTileUnderTank();
      const spd      = Math.round(Math.hypot(this.tank.body.velocity.x, this.tank.body.velocity.y));
      const terrain  = this.TERRAIN_NAMES[tileVal] ?? '?';
      const busy     = this.builder.isBusy ? '  [soldier out]' : '';
      const action   = this.actionPanel.selectedAction;
      const pillLabel = this.tank.pillsCarried > 0 ? '  [pill]' : '';
      this.hudText.setText(`Spd: ${spd}  Terrain: ${terrain}\nAction: ${action}${busy}${pillLabel}`)
        .setVisible(this.hudTextVisible);
      this.resourceText.setText('');

      const BF = 69;
      this.statBars.hp    .setSize(Math.max(0, (this.tank.health / 10)  * BF), 8);
      this.statBars.shells.setSize(Math.max(0, (this.tank.shells / 200) * BF), 8);
      this.statBars.mines .setSize(Math.max(0, (this.tank.mines  / 20)  * BF), 8);
      this.statBars.trees .setSize(Math.max(0, (this.tank.trees  / 40)  * BF), 8);
    }

    this.gameOverUI.updateTimerDisplay(this.gameTimer, this.multiplayerMode);
  }
}
