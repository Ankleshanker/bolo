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
import { Chyron } from '../ui/Chyron';
import { networkManager } from '../network/NetworkManager';
import { GhostTankManager } from '../network/GhostTankManager';
import type { S2C_GameStart, S2C_GameOver, S2C_StateSnapshot } from '../network/types.ts';
import type { MapData } from '../map/MapData';

const WALL_DAMAGE_CHAIN: Record<number, number> = { 8: 9, 9: 6, 6: 3 };
const GAME_DURATION_MS = 5 * 60 * 1000;

const COST_ROAD    = 2;
const COST_WALL    = 4;
const COST_PILLBOX = 10;
const TREES_PER_HARVEST = 4;

interface MineMarker {
  tileX: number;
  tileY: number;
  sprite: Phaser.GameObjects.Sprite;
}

interface BoatMarker {
  tileX: number;
  tileY: number;
  sprite: Phaser.GameObjects.Sprite;
}

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
  private mines: MineMarker[] = [];
  private boats: BoatMarker[] = [];
  private inBoat      = false;
  private activeBoat: BoatMarker | null = null;
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

  // Base markers
  private baseRects: Phaser.GameObjects.Rectangle[] = [];

  // State
  private dead          = false;
  private respawnTimer  = 0;
  private _sinking      = false;
  private lastBaseTileX = -1;
  private lastBaseTileY = -1;
  private _mineDropTileX = -1;
  private _mineDropTileY = -1;

  // Timer / game over
  private gameTimer    = GAME_DURATION_MS;
  private gameOver     = false;
  private timerText!:    Phaser.GameObjects.Text;
  private scoreText!:    Phaser.GameObjects.Text;
  private spectatorText!: Phaser.GameObjects.Text;
  private gameOverObjs: Phaser.GameObjects.GameObject[] = [];
  private initData: GameSceneInitData = {};

  // ── Multiplayer ───────────────────────────────────────────────────────────
  private multiplayerMode = false;
  private ghostManager: GhostTankManager | null = null;
  private remoteBullets: BulletManager | null = null;
  private remoteBulletKillZones: Map<string, number> = new Map();
  private mpSendAccum   = 0;     // ms accumulator for 20 Hz send throttle
  private spectatorMode = false;
  private spectatorTargetIdx = 0;
  private mpGameStart: S2C_GameStart | null = null;
  private killFeedObjs: Phaser.GameObjects.Text[] = [];
  private chyron!: Chyron;
  private playerNames = new Map<string, string>();
  // Store net handlers as arrow fns so we can remove them on shutdown
  private _netHandlers: Array<{ event: string; fn: (d: unknown) => void }> = [];

  constructor() {
    super({ key: 'GameScene' });
  }

  init(data: GameSceneInitData) {
    this.initData        = data ?? {};
    this.multiplayerMode = !!(data?.multiplayerMode);
    this.mpGameStart     = data?.gameStart ?? null;
    this.gameTimer       = GAME_DURATION_MS;
    this.gameOver        = false;
    this.gameOverObjs    = [];
    this.boats           = [];
    this.inBoat          = false;
    this.activeBoat      = null;
    this.spectatorMode   = false;
    this.spectatorTargetIdx = 0;
    this.mpSendAccum     = 0;
    this.killFeedObjs    = [];
    this._netHandlers    = [];
    this.playerNames     = new Map();
    this._mineDropTileX  = -1;
    this._mineDropTileY  = -1;
  }

  create() {
    this.mapData        = this.loadMapData();
    this.buildTilemap();
    this.spawnTank();
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

    this.setupCollision();
    this.setupCamera();
    this.keys          = new InputHandler(this);
    this.actionPanel   = new ActionPanel(this);
    this.settingsPanel = new SettingsPanel(this);
    this.buildHUD();
    this.setupUiCamera();
    this.buildMinimap();
    this.soundManager  = new SoundManager();

    const resume = () => this.soundManager.resume();
    this.input.once('pointerdown', resume);
    this.input.keyboard!.once('keydown', resume);

    this.setupWorldClick();
    this.buildTimerHUD();

    if (this.multiplayerMode) {
      this.setupMultiplayer();
    }
  }

  update(_time: number, delta: number) {
    if (this.gameOver) return;

    // Timer (SP only — MP timer driven by server timeUpdate events)
    if (!this.multiplayerMode) {
      this.gameTimer -= delta;
      if (this.gameTimer <= 0) { this.triggerGameOver(); return; }
    }

    // Spectator camera (MP only)
    if (this.multiplayerMode && this.dead && this.spectatorMode) {
      this._updateSpectator();
    }

    this.chyron.update(delta);

    if (this.dead) {
      this._mineDropTileX = -1;
      this._mineDropTileY = -1;
      this.handleRespawn(delta);
      this.updateMinimap();
      this.updateHUD();
      return;
    }

    const tileVal = this.getTileUnderTank();
    this.checkBoatInteraction();

    if (!this._sinking && !this.inBoat && tileVal === DisplayTile.Sea) {
      this.startSinking();
    }

    if (!this._sinking) {
      const state = this.keys.getState();
      const onWater = tileVal === DisplayTile.Sea || tileVal === DisplayTile.Shallow;
      const terrainSpeed = (this.inBoat && onWater) ? 1.0 : (TERRAIN_SPEED[tileVal] ?? 1.0);
      this.tank.updateTank(delta, state, terrainSpeed);

      // SHIFT mine-drop: lay a mine on the tile just vacated when moving
      const cx = this.tank.tileX;
      const cy = this.tank.tileY;
      if (this._mineDropTileX !== -1 && (cx !== this._mineDropTileX || cy !== this._mineDropTileY)) {
        if (state.layMine) {
          this.placeMineAt(this._mineDropTileX, this._mineDropTileY);
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
        const pillTargets: { x: number; y: number; hidden: boolean }[] = [];
        if (!this.dead) pillTargets.push({ x: this.tank.x, y: this.tank.y, hidden: inForest });
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
    this.checkMines();
    this.checkBaseInteraction();
    this.settingsPanel.update(delta);
    this.updateMinimap();
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
          inBoat:   this.inBoat,
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
    // Remove all registered network handlers
    for (const { event, fn } of this._netHandlers) {
      networkManager.off(event as Parameters<typeof networkManager.off>[0], fn as never);
    }
    this._netHandlers = [];
    this.ghostManager?.clear();
  }

  // ─── Multiplayer setup ───────────────────────────────────────────────────

  private _addNetHandler<K extends Parameters<typeof networkManager.on>[0]>(
    event: K,
    fn: Parameters<typeof networkManager.on<K>>[1],
  ): void {
    networkManager.on(event, fn);
    this._netHandlers.push({ event, fn: fn as (d: unknown) => void });
  }

  private setupMultiplayer(): void {
    const net = networkManager;

    // ── Apply initial players as ghosts ─────────────────────────────────────
    for (const [id, p] of net.players) {
      this.playerNames.set(id, p.name);
      if (id === net.playerId) continue;
      this.ghostManager!.addGhost(id, p.name, p.color, p.teamIndex);
    }

    // Pre-populate server snapshot with ALL objectives as neutral.
    // Without this, the server only knows about objectives that have been updated,
    // so claiming one base from an empty snapshot triggers a false domination win.
    if (net.isHost) {
      for (let i = 0; i < this.pillboxes.pills.length; i++) {
        const pill = this.pillboxes.pills[i];
        networkManager.sendPillboxUpdate(i, null, pill.health, pill.alive);
      }
      for (let i = 0; i < this.mapData.bases.length; i++) {
        networkManager.sendBaseUpdate(i, null);
      }
    }

    // ── Player events ────────────────────────────────────────────────────────
    this._addNetHandler('playerJoined', (d) => {
      this.playerNames.set(d.player.playerId, d.player.name);
      if (d.player.playerId !== net.playerId) {
        this.ghostManager!.addGhost(d.player.playerId, d.player.name, d.player.color, d.player.teamIndex);
      }
      this.chyron.push(`${d.player.name} has joined the battle.`);
    });

    this._addNetHandler('playerGhosted', (d) => {
      this.ghostManager!.setGhosted(d.playerId, true);
    });

    this._addNetHandler('playerReconnected', (d) => {
      this.playerNames.set(d.playerId, d.player.name);
      this.ghostManager!.setGhosted(d.playerId, false);
    });

    this._addNetHandler('playerRemoved', (d) => {
      const name = this.playerNames.get(d.playerId) ?? 'A player';
      this.playerNames.delete(d.playerId);
      this.ghostManager!.removeGhost(d.playerId);
      this.chyron.push(`${name} left the battle.`);
    });

    // ── Tank positions ────────────────────────────────────────────────────────
    this._addNetHandler('tankState', (state) => {
      if (state.playerId !== net.playerId) {
        this.ghostManager!.updateSnapshot(state);
      }
    });

    // ── World state ───────────────────────────────────────────────────────────
    this._addNetHandler('stateSnapshot', (d) => {
      this.applySnapshot(d);
    });

    this._addNetHandler('tileChanged', (d) => {
      if (this.mapData.terrain[d.tileY]?.[d.tileX] === DisplayTile.Forest) {
        this.remoteBulletKillZones.set(`${d.tileX},${d.tileY}`, Date.now() + 500);
      }
      this.setTile(d.tileX, d.tileY, d.displayTile, false);
    });

    this._addNetHandler('pillboxUpdate', (d) => {
      const pill = this.pillboxes.pills[d.index];
      if (!pill) return;
      if (!d.alive) {
        if (pill.alive) pill.takeDamage(pill.health); // kill it
        if (!networkManager.isHost) this.chyron.push('A pillbox was destroyed.');
      } else {
        const owner = d.ownerId === null ? 'neutral'
          : net.isMyTeam(d.ownerId) ? 'friendly' : 'enemy';
        if (pill.owner !== owner || !pill.alive) pill.capture(owner);
        // Sync health (server is authoritative)
        pill.health = d.health;
      }
    });

    this._addNetHandler('baseUpdate', (d) => {
      const base = this.mapData.bases[d.index];
      if (!base) return;
      if (d.ownerId === null) {
        base.owner = 0xFF; // neutral
        this.baseRects[d.index]?.setFillStyle(0xffaa00);
      } else if (net.isMyTeam(d.ownerId)) {
        base.owner = 0x00; // friendly
        this.baseRects[d.index]?.setFillStyle(this.teamColor());
        if (d.ownerId !== net.playerId) {
          const name = this.playerNames.get(d.ownerId) ?? 'A teammate';
          this.chyron.push(`${name} claimed a base.`);
        }
      } else {
        base.owner = 0x01; // enemy
        this.baseRects[d.index]?.setFillStyle(0xff4444);
        const name = this.playerNames.get(d.ownerId) ?? 'An enemy';
        this.chyron.push(`${name} claimed a base.`);
      }
    });

    this._addNetHandler('mineAdded', (d) => {
      if (this.mines.some(m => m.tileX === d.tileX && m.tileY === d.tileY)) return;
      const sprite = this.add.sprite(
        (d.tileX + 0.5) * TILE_SIZE, (d.tileY + 0.5) * TILE_SIZE, 'mine',
      ).setDepth(1);
      this.mines.push({ tileX: d.tileX, tileY: d.tileY, sprite });
    });

    this._addNetHandler('mineDetonated', (d) => {
      const i = this.mines.findIndex(m => m.tileX === d.tileX && m.tileY === d.tileY);
      if (i >= 0) { this.mines[i].sprite.destroy(); this.mines.splice(i, 1); }
      this.setTile(d.tileX, d.tileY, DisplayTile.Crater, false);
      const cx = (d.tileX + 0.5) * TILE_SIZE;
      const cy = (d.tileY + 0.5) * TILE_SIZE;
      this.soundManager.playMineExplosion(this.soundDist(cx, cy));
      this.spawnExplosionAt(cx, cy, true);
      // If we triggered it (our own mine detonated remotely), damage already applied locally
    });

    this._addNetHandler('boatAdded', (d) => {
      this.ensureBoatAtTile(d.tileX, d.tileY);
    });

    // ── Combat ────────────────────────────────────────────────────────────────
    this._addNetHandler('bulletFired', (d) => {
      if (d.shooterId === net.playerId) return; // we already spawned our own bullet
      const b = this.remoteBullets!.group.get(d.x, d.y, 'bullet') as Phaser.Physics.Arcade.Sprite | null;
      if (!b) return;
      b.setActive(true).setVisible(true).setDepth(6);
      (b.body as Phaser.Physics.Arcade.Body).enable = true;
      const rad = Phaser.Math.DegToRad(d.angleDeg - 90);
      b.setVelocity(Math.cos(rad) * 480, Math.sin(rad) * 480);
      b.setData('life', 1800);
      b.setData('shooterId', d.shooterId);
    });

    this._addNetHandler('bulletHit', (d) => {
      if (d.targetId !== net.playerId) return; // not us
      if (this.dead) return;
      this.soundManager.playHitTank();
      const killed = this.tank.takeDamage();
      if (killed) {
        const shooterId = d.shooterId;
        this.time.delayedCall(0, () => {
          this.onTankKilled();
          // Victim self-reports death with killer attribution
          net.sendPlayerKillSelf(shooterId);
        });
      }
    });

    this._addNetHandler('playerKill', (d) => {
      this._showKillFeed(`${d.killerName} ✕ ${d.victimName}`);
      this.chyron.push(`${d.killerName} destroyed ${d.victimName}.`);
    });

    // ── Pillbox bullets (host-authoritative) ──────────────────────────────────
    // Non-hosts receive this event and fire the bullet locally.
    // The host fires locally and does NOT receive its own relay.
    this._addNetHandler('pillboxBulletFired', (d) => {
      // Sync pill sprite rotation to match host's decision
      const pill = this.pillboxes.pills[d.pillIndex];
      if (pill) pill.sprite.angle = d.angleDeg;
      // Fire bullet into pillboxBullets pool — existing tank overlap handles damage
      this.pillboxBullets.fire(d.x, d.y, d.angleDeg);
      this.soundManager.playPillboxFire(this.soundDist(d.x, d.y));
    });

    // ── Timer ──────────────────────────────────────────────────────────────────
    this._addNetHandler('timeUpdate', (d) => {
      this.gameTimer = d.remaining;
    });

    // ── Game over ─────────────────────────────────────────────────────────────
    this._addNetHandler('gameOver', (d) => {
      this.triggerGameOverMP(d);
    });

    // ── Soldier state (builder visibility) ───────────────────────────────────
    this._addNetHandler('soldierState', (d) => {
      this.ghostManager!.updateSoldier(d.playerId, d.x, d.y, d.active);
    });

    // ── Pillbox fire relay (non-host: apply angle + fire locally) ────────────
    this._addNetHandler('pillboxFire', (d) => {
      const pill = this.pillboxes.pills[d.pillIndex];
      if (!pill || !pill.alive || pill.owner === 'friendly') return;
      pill.setFacing(d.angleDeg);
      pill.fireAt(d.angleDeg, this.pillboxBullets);
      this.soundManager.playPillboxFire(this.soundDist(pill.x, pill.y));
    });

    // Pull a fresh snapshot now that all handlers are registered.
    // The server sends stateSnapshot immediately after gameStart/roomJoined,
    // which arrives before this scene's create() runs and is dropped.
    // Requesting it here guarantees late joiners receive current world state.
    networkManager.sendRequestSnapshot();

    // ── Spectator keys ─────────────────────────────────────────────────────────
    this.input.keyboard!.on('keydown-Q', () => {
      if (this.spectatorMode) {
        this.spectatorTargetIdx--;
        if (this.spectatorTargetIdx < 0) this.spectatorTargetIdx = 0;
      }
    });
    this.input.keyboard!.on('keydown-E', () => {
      if (this.spectatorMode) this.spectatorTargetIdx++;
    });
  }

  private applySnapshot(snap: S2C_StateSnapshot): void {
    // Apply terrain diffs
    for (const diff of snap.terrainDiffs) {
      this.setTile(diff.tileX, diff.tileY, diff.displayTile, false);
    }
    // Sync pillbox states
    for (const ps of snap.pillboxStates) {
      const pill = this.pillboxes.pills[ps.index];
      if (!pill) continue;
      const net = networkManager;
      if (!ps.alive) {
        if (pill.alive) pill.takeDamage(pill.health);
      } else {
        const owner = ps.ownerId === null ? 'neutral'
          : net.isMyTeam(ps.ownerId) ? 'friendly' : 'enemy';
        if (pill.owner !== owner || !pill.alive) pill.capture(owner);
        pill.health = ps.health;
      }
    }
    // Sync bases
    for (const bs of snap.baseStates) {
      const base = this.mapData.bases[bs.index];
      if (!base) continue;
      const net = networkManager;
      if (bs.ownerId === null) {
        base.owner = 0xFF;
        this.baseRects[bs.index]?.setFillStyle(0xffaa00);
      } else if (net.isMyTeam(bs.ownerId)) {
        base.owner = 0x00;
        this.baseRects[bs.index]?.setFillStyle(this.teamColor());
      } else {
        base.owner = 0x01;
        this.baseRects[bs.index]?.setFillStyle(0xff4444);
      }
    }
    // Mines
    for (const m of snap.mines) {
      if (this.mines.some(mm => mm.tileX === m.tileX && mm.tileY === m.tileY)) continue;
      const sprite = this.add.sprite(
        (m.tileX + 0.5) * TILE_SIZE, (m.tileY + 0.5) * TILE_SIZE, 'mine',
      ).setDepth(1);
      this.mines.push({ tileX: m.tileX, tileY: m.tileY, sprite });
    }
    // Boats
    for (const b of snap.boats) {
      this.ensureBoatAtTile(b.tileX, b.tileY);
    }
    // Ghost tank states
    for (const ts of snap.tankStates) {
      if (ts.playerId !== networkManager.playerId) {
        this.ghostManager?.updateSnapshot(ts);
      }
    }
    // Sync timer
    this.gameTimer = this.mpGameStart!.settings.timerSeconds * 1000 - snap.timeElapsed;
  }

  private _showKillFeed(msg: string): void {
    const vw = this.scale.width - PANEL_WIDTH;
    const y  = this.scale.height - 60 - this.killFeedObjs.length * 18;
    const t  = this.add.text(vw - 10, y, msg, {
      fontSize: '11px', color: '#ffdd88',
      backgroundColor: '#00000088',
      padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(32).setOrigin(1, 1);
    this.uiCam.ignore(t);
    this.killFeedObjs.push(t);
    this.time.delayedCall(3000, () => {
      t.destroy();
      const i = this.killFeedObjs.indexOf(t);
      if (i >= 0) this.killFeedObjs.splice(i, 1);
    });
  }

  private _updateSpectator(): void {
    const aliveIds = this.ghostManager?.getAlivePlayerIds() ?? [];
    if (aliveIds.length === 0) {
      this.cameras.main.startFollow(this.tank.sprite, true, 0.12, 0.12);
      this.spectatorText.setVisible(false);
      return;
    }
    const idx    = ((this.spectatorTargetIdx % aliveIds.length) + aliveIds.length) % aliveIds.length;
    const target = this.ghostManager?.getSpriteByPlayerId(aliveIds[idx]);
    if (target) this.cameras.main.startFollow(target, true, 0.12, 0.12);
    const name = networkManager.players.get(aliveIds[idx])?.name ?? 'Unknown';
    this.spectatorText.setText(`SPECTATING: ${name}   [Q] / [E] to switch`).setVisible(true);
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
    this.renderMapObjects();
  }

  private renderMapObjects() {
    for (const base of this.mapData.bases) {
      const cx = base.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = base.y * TILE_SIZE + TILE_SIZE / 2;
      const neutral = base.owner === 0xFF;
      const rect = this.add.rectangle(cx, cy, 24, 24, neutral ? 0xffaa00 : this.teamColor()).setDepth(2);
      this.baseRects.push(rect);
      this.add.text(cx, cy, '★', { fontSize: '14px', color: '#000000' }).setDepth(3).setOrigin(0.5);
    }
  }

  private setTile(tileX: number, tileY: number, displayTile: number, broadcast = true) {
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
      this.ensureBoatAtTile(stx, sty);
    }
  }

  private onTankKilled() {
    this.dead = true;
    this.respawnTimer = 3000;
    this.inBoat     = false;
    this.activeBoat = null;
    this.builder.cancel();
    const { x, y } = this.tank;
    this.time.delayedCall(0, () => this.spawnExplosionAt(x, y));
    this.tank.sprite.setVisible(false);
    this.tank.body.enable = false;

    // In MP: enter spectator mode while waiting to respawn
    if (this.multiplayerMode) {
      this.spectatorMode = true;
      this.spectatorTargetIdx = 0;
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
      this.ensureBoatAtTile(stx, sty);
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
      this.spectatorMode = false;
      this.spectatorText.setVisible(false);
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
        const next = WALL_DAMAGE_CHAIN[t.index];
        if (next !== undefined) this.setTile(t.x, t.y, next);
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
              if (!this.multiplayerMode) {
                const pickup = this.add.sprite(x, y, 'pill_neutral')
                  .setDepth(4).setScale(0.65).setAlpha(0.9);
                this.pillPickups.push(pickup);
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

    // MP-only: my bullets hit remote players
    if (this.multiplayerMode && this.ghostManager) {
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
      this.minimapTerrain?.setPosition(this._minimapObjX(), this._minimapObjY());
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

  private buildTimerHUD() {
    const style = { fontSize: '14px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 4 } };
    this.timerText = this.add.text(0, 8, '', style).setScrollFactor(0).setDepth(30);
    this.scoreText = this.add.text(0, 32, '', style).setScrollFactor(0).setDepth(30);
    this.spectatorText = this.add.text(0, 20, '', {
      fontSize: '12px', color: '#ffdd88', backgroundColor: '#00000099', padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(30).setOrigin(0.5, 0).setVisible(false);
    this.repositionTimerHUD();
    this.scale.on('resize', () => this.repositionTimerHUD());
    this.uiCam.ignore([this.timerText, this.scoreText, this.spectatorText]);
  }

  private repositionTimerHUD() {
    const vw = this.scale.width - PANEL_WIDTH;
    this.timerText.setX(vw - 140);
    this.scoreText.setX(vw - 140);
    this.spectatorText?.setX(vw / 2);
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
    this.soundManager.playGameOver();
    this.tank.body.setVelocity(0, 0);
    this.tank.body.enable = false;
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

  private triggerGameOverMP(d: S2C_GameOver) {
    if (this.gameOver) return;
    this.gameOver = true;
    this.soundManager.playGameOver();
    if (!this.dead) {
      this.tank.body.setVelocity(0, 0);
      this.tank.body.enable = false;
    }

    const vw = this.scale.width - PANEL_WIDTH;
    const vh = this.scale.height;
    const cx = vw / 2;
    const cy = vh / 2;
    const D  = 60;
    const push = (obj: Phaser.GameObjects.GameObject) => { this.gameOverObjs.push(obj); return obj; };

    const REASON_LABELS: Record<string, string> = {
      timer:      "TIME'S UP",
      domination: 'DOMINATION',
      deathmatch: 'DEATHMATCH OVER',
      lastPlayer: 'LAST TANK STANDING',
    };

    push(this.add.rectangle(cx, cy, vw, vh, 0x000000, 0.80).setScrollFactor(0).setDepth(D).setInteractive());
    push(this.add.text(cx, cy - 120, REASON_LABELS[d.reason] ?? 'GAME OVER', {
      fontSize: '36px', color: '#ffdd44', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));

    if (d.winnerName) {
      push(this.add.text(cx, cy - 70, `Winner: ${d.winnerName}`, { fontSize: '20px', color: '#88ff88' })
        .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    }

    // Score table
    let ty = cy - 30;
    push(this.add.text(cx, ty, 'PLAYER          K    D    OBJ', {
      fontSize: '11px', color: '#556677', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    ty += 18;

    const net = networkManager;
    for (const s of d.scores) {
      const isMe = s.playerId === net.playerId;
      push(this.add.text(cx, ty,
        `${(s.name + '                  ').slice(0, 16)} ${String(s.kills).padStart(4)}${String(s.deaths).padStart(5)}${String(s.objectives).padStart(6)}`,
        { fontSize: '11px', color: isMe ? '#aaffaa' : '#aabbcc', fontFamily: 'monospace' })
        .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
      ty += 16;
    }

    const btnY = Math.max(cy + 80, ty + 30);
    const lobbyBtn = push(this.add.rectangle(cx, btnY, 200, 44, 0x1a4a1a)
      .setStrokeStyle(2, 0x44aa44).setScrollFactor(0).setDepth(D + 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        networkManager.leaveRoom();
        this.scene.start('LobbyScene');
      })
      .on('pointerover', () => (lobbyBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x2a6a2a))
      .on('pointerout',  () => (lobbyBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x1a4a1a)));
    push(this.add.text(cx, btnY, 'BACK TO LOBBY', { fontSize: '16px', color: '#88ff88', fontStyle: 'bold' })
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
            this.ensureBoatAtTile(tileX, tileY);
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
          const pill = this.pillboxes.addPill(tileX, tileY);
          if (this.multiplayerMode) {
            const idx = this.pillboxes.pills.indexOf(pill);
            networkManager.sendPillboxUpdate(idx, networkManager.playerId, 4, true);
          }
        });
        break;

      case 'placeMine':
        if (t.mines <= 0) return;
        if (tile === DisplayTile.Sea) return;
        t.mines--;
        this.dispatchSoldier(tileX, tileY, () => {
          this._spawnMineSprite(tileX, tileY);
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
    if (this.multiplayerMode) return; // MP: pills don't drop pickups
    if (this.tank.pillsCarried >= 1) return;
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    for (let i = this.pillPickups.length - 1; i >= 0; i--) {
      const pickup = this.pillPickups[i];
      const ptx = Math.floor(pickup.x / TILE_SIZE);
      const pty = Math.floor(pickup.y / TILE_SIZE);
      if (ptx === tx && pty === ty) {
        this.tank.pillsCarried = 1;
        this.soundManager.playPillPickup();
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

  private ensureBoatAtTile(tileX: number, tileY: number) {
    if (this.boats.some(b => b.tileX === tileX && b.tileY === tileY)) return;
    const sprite = this.add.sprite(
      (tileX + 0.5) * TILE_SIZE, (tileY + 0.5) * TILE_SIZE, 'boat',
    ).setDepth(1);
    this.boats.push({ tileX, tileY, sprite });
  }

  private checkBoatInteraction() {
    if (this.dead) return;
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    const tileVal = this.mapData.terrain[ty]?.[tx] ?? DisplayTile.Sea;
    const onWater = tileVal === DisplayTile.Sea || tileVal === DisplayTile.Shallow;

    if (this.inBoat && this.activeBoat) {
      if (onWater) {
        this.activeBoat.tileX = tx;
        this.activeBoat.tileY = ty;
        this.activeBoat.sprite.setPosition(this.tank.x, this.tank.y);
      } else {
        this.inBoat     = false;
        this.activeBoat = null;
        this.soundManager.playBoatExit();
      }
    } else if (!this.inBoat) {
      for (const boat of this.boats) {
        if (boat.tileX === tx && boat.tileY === ty) {
          this.inBoat     = true;
          this.activeBoat = boat;
          this.soundManager.playBoatEnter();
          break;
        }
      }
    }
  }

  private _spawnMineSprite(tileX: number, tileY: number) {
    const sprite = this.add.sprite(
      (tileX + 0.5) * TILE_SIZE, (tileY + 0.5) * TILE_SIZE, 'mine',
    ).setDepth(1);
    this.mines.push({ tileX, tileY, sprite });
  }

  private placeMineAt(tileX: number, tileY: number) {
    if (this.tank.mines <= 0) return;
    const tile = this.mapData.terrain[tileY]?.[tileX] ?? DisplayTile.Sea;
    if (tile === DisplayTile.Sea) return;
    if (this.mines.some(m => m.tileX === tileX && m.tileY === tileY)) return;
    this.tank.mines--;
    this._spawnMineSprite(tileX, tileY);
    this.soundManager.playLayMine(this.soundDist(
      (tileX + 0.5) * TILE_SIZE, (tileY + 0.5) * TILE_SIZE,
    ));
    if (this.multiplayerMode) networkManager.sendMineAdded(tileX, tileY);
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
        this.soundManager.playMineExplosion(this.soundDist(x, y));
        this.spawnExplosionAt(x, y, true);
        this.setTile(m.tileX, m.tileY, DisplayTile.Crater);
        const killed = this.tank.takeDamage(3);
        this.chyron.push('You hit a mine!');
        if (killed) this.time.delayedCall(0, () => this.onTankKilled());
        if (this.multiplayerMode) networkManager.sendMineDetonated(m.tileX, m.tileY);
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
        // Neutral → capture
        base.owner = 0x00;
        this.baseRects[i]?.setFillStyle(this.teamColor());
        this.soundManager.playBuildTile();
        this.chyron.push('You claimed a base.');
        if (this.multiplayerMode) networkManager.sendBaseUpdate(i, networkManager.playerId);
      } else if (base.owner === 0x00) {
        // Friendly → resupply
        this.tank.shells = 200;
        this.tank.health = Math.min(10, this.tank.health + 5);
        this.tank.mines  = Math.min(20, this.tank.mines + 5);
        this.soundManager.playBaseResupply();
      }
      return;
    }
    this.lastBaseTileX = -1;
    this.lastBaseTileY = -1;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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

  private spawnExplosionAt(x: number, y: number, skipSound = false) {
    const s = this.add.sprite(x, y, 'explosion').setDepth(8);
    this.time.delayedCall(600, () => s.destroy());
    if (!skipSound) this.soundManager.playExplosion(this.soundDist(x, y));
  }

  private soundDist(wx: number, wy: number): number {
    const MAX_HEAR = 640;
    return Math.min(1, Math.hypot(wx - this.tank.x, wy - this.tank.y) / MAX_HEAR);
  }

  // ─── Minimap ──────────────────────────────────────────────────────────────

  private static readonly MINIMAP_COLORS: number[] = [
    0x007888, 0x009999, 0x050a05, 0x5a3520, 0xa08050,
    0x0a1a0a, 0x7a6a50, 0x2a4a18, 0x4a4a4a, 0x6a6a6a, 0x5a5040,
  ];

  private static readonly MINI = 128;

  private _minimapObjX() { return this.scale.width  - GameScene.MINI - 4 - PANEL_WIDTH; }
  private _minimapObjY() { return this.scale.height - GameScene.MINI - 4; }

  private buildMinimap() {
    const { MINI, MINIMAP_COLORS } = GameScene;
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

    this.minimapTerrain = this.add.sprite(this._minimapObjX(), this._minimapObjY(), 'minimap_terrain')
      .setScrollFactor(0).setScale(MINI / MAP_SIZE).setOrigin(0, 0).setDepth(90);
    this.minimapBlip = this.add.graphics().setScrollFactor(0).setDepth(91);
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
                : pill.owner === 'enemy'    ? 0xff4444 : 0xaaaaaa;
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

    // Ghost dots (MP)
    if (this.multiplayerMode && this.ghostManager) {
      for (const id of this.ghostManager.getAlivePlayerIds()) {
        const sprite = this.ghostManager.getSpriteByPlayerId(id);
        if (!sprite?.visible) continue;
        const col = networkManager.isMyTeam(id) ? 0x44ddff : 0xff6644;
        const mx = objX + (sprite.x / W) * MINI;
        const my = objY + (sprite.y / W) * MINI;
        this.minimapBlip.fillStyle(col, 0.9);
        this.minimapBlip.fillCircle(mx, my, 1.5);
      }
    }

    // Player dot
    if (!this.dead) {
      const px = objX + (this.tank.x / W) * MINI;
      const py = objY + (this.tank.y / W) * MINI;
      this.minimapBlip.fillStyle(0xffffff, 1);
      this.minimapBlip.fillCircle(px, py, 2);
    }

    this.minimapBlip.lineStyle(1, 0x777777, 0.9);
    this.minimapBlip.strokeRect(objX, objY, MINI, MINI);

    // Spectator overlay
    if (this.multiplayerMode && this.dead && this.spectatorMode) {
      this.minimapBlip.lineStyle(1, 0x4488ff, 0.6);
      this.minimapBlip.strokeRect(objX, objY + MINI + 2, MINI, 14);
      this.minimapBlip.fillStyle(0x00000099);
      this.minimapBlip.fillRect(objX, objY + MINI + 2, MINI, 14);
    }
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

    this.chyron = new Chyron(this, this.scale.width - PANEL_WIDTH, this.scale.height);
  }

  private readonly TERRAIN_NAMES: Record<number, string> = {
    0: 'Sea', 1: 'Shallow', 2: 'Swamp', 3: 'Crater',
    4: 'Road', 5: 'Forest', 6: 'Rubble', 7: 'Grass',
    8: 'Wall', 9: 'Dmg.Wall',
  };

  private updateHUD() {
    if (this.dead) {
      const secs = Math.ceil(this.respawnTimer / 1000);
      const label = this.multiplayerMode && this.spectatorMode
        ? `DESTROYED — respawning in ${secs}s  (Q/E to cycle views)`
        : `DESTROYED — respawning in ${secs}s`;
      this.hudText.setText(label);
      this.resourceText.setText('');
    } else {
      const tileVal  = this.getTileUnderTank();
      const spd      = Math.round(Math.hypot(this.tank.body.velocity.x, this.tank.body.velocity.y));
      const terrain  = this.TERRAIN_NAMES[tileVal] ?? '?';
      const busy     = this.builder.isBusy ? '  [soldier out]' : '';
      const action   = this.actionPanel.selectedAction;
      const pillLabel = this.tank.pillsCarried > 0 ? '  [pill]' : '';
      this.hudText.setText(`Spd: ${spd}  Terrain: ${terrain}\nAction: ${action}${busy}${pillLabel}`);
      this.resourceText.setText('');

      const BF = 69;
      this.statBars.hp    .setSize(Math.max(0, (this.tank.health / 10)  * BF), 8);
      this.statBars.shells.setSize(Math.max(0, (this.tank.shells / 200) * BF), 8);
      this.statBars.mines .setSize(Math.max(0, (this.tank.mines  / 20)  * BF), 8);
      this.statBars.trees .setSize(Math.max(0, (this.tank.trees  / 40)  * BF), 8);
    }

    const remaining = Math.max(0, this.gameTimer);
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const score = this.countScore();
    this.timerText.setText(`⏱ ${mins}:${secs.toString().padStart(2, '0')}`);
    this.scoreText.setText(this.multiplayerMode
      ? `⚑ ${score.friendly}/${score.total}`
      : `⚑ ${score.friendly}/${score.total}`);
  }
}
