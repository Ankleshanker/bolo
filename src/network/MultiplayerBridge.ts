import Phaser from 'phaser';
import { networkManager } from './NetworkManager';
import type { Tank } from '../entities/Tank';
import type { PillboxManager } from '../entities/Pillbox';
import type { BulletManager } from '../entities/Bullet';
import type { BaseManager } from '../entities/BaseManager';
import type { MineSystem } from '../entities/MineSystem';
import type { GhostTankManager } from './GhostTankManager';
import type { Chyron } from '../ui/Chyron';
import type { SoundManager } from '../audio/SoundManager';
import type { GameOverUI } from '../ui/GameOverUI';
import type { MapData } from '../map/MapData';
import type { S2C_GameStart, S2C_StateSnapshot } from './types';
import { DisplayTile } from '../map/TileTypes';
import { PANEL_WIDTH } from '../ui/ActionPanel';

export interface BridgeContext {
  scene: Phaser.Scene;
  tank: Tank;
  mapData: MapData;
  pillboxes: PillboxManager;
  baseManager: BaseManager;
  mineSystem: MineSystem;
  ghostManager: GhostTankManager;
  remoteBullets: BulletManager;
  playerBullets: BulletManager;
  pillboxBullets: BulletManager;
  chyron: Chyron;
  soundManager: SoundManager;
  gameOverUI: GameOverUI;
  uiCam: Phaser.Cameras.Scene2D.Camera;
  mpGameStart: S2C_GameStart | null;
  isDead: () => boolean;
  setTile: (tx: number, ty: number, displayTile: number, broadcast?: boolean) => void;
  spawnExplosionAt: (x: number, y: number, skipSound?: boolean) => void;
  soundDist: (wx: number, wy: number) => number;
  onTankKilled: () => void;
  onTimerUpdate: (remaining: number) => void;
  onRemoteForestChanged: (key: string, expiry: number) => void;
}

export class MultiplayerBridge {
  private readonly ctx: BridgeContext;
  private _netHandlers: Array<{ event: string; fn: (d: unknown) => void }> = [];
  private playerNames = new Map<string, string>();
  private killFeedObjs: Phaser.GameObjects.Text[] = [];
  private _spectatorMode = false;
  private spectatorTargetIdx = 0;
  private pillPickups: { sprite: Phaser.GameObjects.Sprite; id: string }[] = [];
  private pendingPillCollects = new Set<string>();

  constructor(ctx: BridgeContext) {
    this.ctx = ctx;
  }

  /** Replaces setupMultiplayer(). Call at end of GameScene.create(). */
  setup(): void {
    const net = networkManager;
    const ctx = this.ctx;

    // ── Room code label + copy button (above settings gear, uiCam only) ──
    const scene = this.ctx.scene;
    const cx        = PANEL_WIDTH / 2;
    const boxCY     = () => scene.scale.height - 73;
    const codeBg    = scene.add.rectangle(cx, boxCY(), 90, 50, 0x0d1f33)
      .setStrokeStyle(1, 0x2244aa).setDepth(21).setScrollFactor(0);
    const codeLabel = scene.add.text(cx, boxCY() - 14, 'ROOM CODE', {
      fontSize: '10px', color: '#8899aa', letterSpacing: 1,
    }).setDepth(22).setScrollFactor(0).setOrigin(0.5, 0.5);
    const codeValue = scene.add.text(cx, boxCY(), networkManager.roomCode, {
      fontSize: '13px', color: '#aaddff', fontStyle: 'bold', letterSpacing: 3,
    }).setDepth(22).setScrollFactor(0).setOrigin(0.5, 0.5);
    const copyBtn   = scene.add.text(cx, boxCY() + 14, '📋 Copy', {
      fontSize: '10px', color: '#667788',
    }).setDepth(22).setScrollFactor(0).setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => copyBtn.setStyle({ color: '#aaddff' }))
      .on('pointerout',  () => copyBtn.setStyle({ color: '#667788' }))
      .on('pointerdown', () => {
        navigator.clipboard.writeText(
          `Join my Bolo Online game using the following room code: ${networkManager.roomCode}\nhttps://bolo-online.com?room=${networkManager.roomCode}`,
        );
        copyBtn.setText('✓ Copied!').setStyle({ color: '#88ff88' });
        scene.time.delayedCall(1500, () => {
          copyBtn.setText('📋 Copy').setStyle({ color: '#667788' });
        });
      });
    scene.cameras.main.ignore([codeBg, codeLabel, codeValue, copyBtn]);
    scene.scale.on('resize', () => {
      const y = boxCY();
      codeBg.setY(y); codeLabel.setY(y - 14); codeValue.setY(y); copyBtn.setY(y + 14);
    });

    // ── Apply initial players as ghosts ────────────────────────────────────────
    for (const [id, p] of net.players) {
      this.playerNames.set(id, p.name);
      if (id === net.playerId) continue;
      ctx.ghostManager.addGhost(id, p.name, p.color, p.teamIndex);
    }

    // Pre-populate server snapshot with ALL objectives as neutral.
    if (net.isHost) {
      for (let i = 0; i < ctx.pillboxes.pills.length; i++) {
        const pill = ctx.pillboxes.pills[i];
        networkManager.sendPillboxUpdate(i, null, pill.health, pill.alive);
      }
      for (let i = 0; i < ctx.mapData.bases.length; i++) {
        networkManager.sendBaseUpdate(i, null, 0, 0, 0);
      }
    }

    // ── Player events ──────────────────────────────────────────────────────────
    this._addNetHandler('playerJoined', (d) => {
      this.playerNames.set(d.player.playerId, d.player.name);
      if (d.player.playerId !== net.playerId) {
        ctx.ghostManager.addGhost(d.player.playerId, d.player.name, d.player.color, d.player.teamIndex);
      }
      ctx.chyron.push(`${d.player.name} has joined the battle.`);
    });

    this._addNetHandler('playerGhosted', (d) => {
      ctx.ghostManager.setGhosted(d.playerId, true);
    });

    this._addNetHandler('playerReconnected', (d) => {
      this.playerNames.set(d.playerId, d.player.name);
      ctx.ghostManager.setGhosted(d.playerId, false);
    });

    this._addNetHandler('playerRemoved', (d) => {
      const name = this.playerNames.get(d.playerId) ?? 'A player';
      this.playerNames.delete(d.playerId);
      ctx.ghostManager.removeGhost(d.playerId);
      ctx.chyron.push(`${name} left the battle.`);
    });

    // ── Tank positions ─────────────────────────────────────────────────────────
    this._addNetHandler('tankState', (state) => {
      if (state.playerId !== net.playerId) {
        ctx.ghostManager.updateSnapshot(state);
      }
    });

    // ── World state ────────────────────────────────────────────────────────────
    this._addNetHandler('stateSnapshot', (d) => {
      this.applySnapshot(d);
    });

    this._addNetHandler('tileChanged', (d) => {
      if (ctx.mapData.terrain[d.tileY]?.[d.tileX] === DisplayTile.Forest) {
        ctx.onRemoteForestChanged(`${d.tileX},${d.tileY}`, Date.now() + 500);
      }
      ctx.setTile(d.tileX, d.tileY, d.displayTile, false);
    });

    this._addNetHandler('pillboxUpdate', (d) => {
      let pill = ctx.pillboxes.pills[d.index];
      // Player-placed pills arrive with position data; create the sprite if we haven't seen this index
      if (!pill && d.alive && d.tileX != null && d.tileY != null) {
        pill = ctx.pillboxes.addPill(d.tileX, d.tileY, d.ownerId);
        if (!networkManager.isHost) ctx.chyron.push('A pillbox was placed.');
      }
      if (!pill) return;
      pill.ownerId = d.ownerId;  // always keep ownerId in sync
      if (!d.alive) {
        if (pill.alive) pill.takeDamage(pill.health);
        if (!networkManager.isHost) ctx.chyron.push('A pillbox was destroyed.');
      } else {
        const owner = d.ownerId === null ? 'neutral'
          : net.isMyTeam(d.ownerId) ? 'friendly' : 'enemy';
        if (pill.owner !== owner || !pill.alive) pill.capture(owner);
        pill.health = d.health;
      }
    });

    this._addNetHandler('pillPickupSpawned', (d) => {
      const sprite = ctx.scene.add.sprite(d.x, d.y, 'pill_neutral')
        .setDepth(4).setScale(0.65).setAlpha(0.9);
      this.pillPickups.push({ sprite, id: d.id });
    });

    this._addNetHandler('pillPickupCollected', (d) => {
      const idx = this.pillPickups.findIndex(p => p.id === d.id);
      if (idx >= 0) {
        this.pillPickups[idx].sprite.destroy();
        this.pillPickups.splice(idx, 1);
      }
      this.pendingPillCollects.delete(d.id);
      if (d.collectorId === networkManager.playerId) {
        ctx.tank.pillsCarried = 1;
        ctx.soundManager.playPillPickup();
      }
    });

    this._addNetHandler('baseUpdate', (d) => ctx.baseManager.handleNetUpdate(d));

    this._addNetHandler('mineAdded',    (d) => ctx.mineSystem.handleMineAdded(d));
    this._addNetHandler('mineDetonated',(d) => ctx.mineSystem.handleMineDetonated(d));
    this._addNetHandler('boatAdded',    (d) => ctx.mineSystem.handleBoatAdded(d));

    // ── Combat ─────────────────────────────────────────────────────────────────
    this._addNetHandler('bulletFired', (d) => {
      if (d.shooterId === net.playerId) return;
      const b = ctx.remoteBullets.group.get(d.x, d.y, 'bullet') as Phaser.Physics.Arcade.Sprite | null;
      if (!b) return;
      b.setActive(true).setVisible(true).setDepth(6);
      (b.body as Phaser.Physics.Arcade.Body).enable = true;
      const rad = Phaser.Math.DegToRad(d.angleDeg - 90);
      b.setVelocity(Math.cos(rad) * 480, Math.sin(rad) * 480);
      b.setData('life', 1800);
      b.setData('shooterId', d.shooterId);
    });

    this._addNetHandler('bulletHit', (d) => {
      if (d.targetId !== net.playerId) return;
      if (ctx.isDead()) return;
      ctx.soundManager.playHitTank();
      const killed = ctx.tank.takeDamage();
      if (killed) {
        const shooterId = d.shooterId;
        ctx.scene.time.delayedCall(0, () => {
          ctx.onTankKilled();
          net.sendPlayerKillSelf(shooterId);
        });
      }
    });

    this._addNetHandler('playerKill', (d) => {
      this._showKillFeed(`${d.killerName} ✕ ${d.victimName}`);
      ctx.chyron.push(`${d.killerName} destroyed ${d.victimName}.`);
    });

    this._addNetHandler('tankPush', (d) => {
      if (ctx.isDead()) return;
      const MAX_PUSH = 240;
      ctx.tank.body.velocity.x = Phaser.Math.Clamp(
        ctx.tank.body.velocity.x + d.impulseX, -MAX_PUSH, MAX_PUSH,
      );
      ctx.tank.body.velocity.y = Phaser.Math.Clamp(
        ctx.tank.body.velocity.y + d.impulseY, -MAX_PUSH, MAX_PUSH,
      );
    });

    this._addNetHandler('pillboxBulletFired', (d) => {
      const pill = ctx.pillboxes.pills[d.pillIndex];
      if (pill) pill.sprite.angle = d.angleDeg;
      ctx.pillboxBullets.fire(d.x, d.y, d.angleDeg);
      ctx.soundManager.playPillboxFire(ctx.soundDist(d.x, d.y));
    });

    this._addNetHandler('timeUpdate', (d) => {
      ctx.onTimerUpdate(d.remaining);
    });

    this._addNetHandler('gameOver', (d) => {
      if (!ctx.isDead()) {
        ctx.tank.body.setVelocity(0, 0);
        ctx.tank.body.enable = false;
      }
      ctx.gameOverUI.triggerMP(d);
    });

    this._addNetHandler('soldierState', (d) => {
      ctx.ghostManager.updateSoldier(d.playerId, d.x, d.y, d.active);
    });

    this._addNetHandler('pillboxFire', (d) => {
      const pill = ctx.pillboxes.pills[d.pillIndex];
      if (!pill || !pill.alive) return;
      pill.setFacing(d.angleDeg);
      pill.fireAt(d.angleDeg, ctx.pillboxBullets);
      ctx.soundManager.playPillboxFire(ctx.soundDist(pill.x, pill.y));
    });

    // Pull a fresh snapshot now that all handlers are registered.
    networkManager.sendRequestSnapshot();

    // ── Spectator keys ─────────────────────────────────────────────────────────
    ctx.scene.input.keyboard!.on('keydown-Q', () => {
      if (this._spectatorMode) {
        this.spectatorTargetIdx--;
        if (this.spectatorTargetIdx < 0) this.spectatorTargetIdx = 0;
      }
    });
    ctx.scene.input.keyboard!.on('keydown-E', () => {
      if (this._spectatorMode) this.spectatorTargetIdx++;
    });
  }

  /** Called when applying a full state snapshot. */
  applySnapshot(snap: S2C_StateSnapshot): void {
    const ctx = this.ctx;

    // Terrain diffs
    for (const diff of snap.terrainDiffs) {
      ctx.setTile(diff.tileX, diff.tileY, diff.displayTile, false);
    }

    // Pillbox states
    for (const ps of snap.pillboxStates) {
      let pill = ctx.pillboxes.pills[ps.index];
      if (!pill && ps.alive && ps.tileX != null && ps.tileY != null) {
        pill = ctx.pillboxes.addPill(ps.tileX, ps.tileY, ps.ownerId);
      }
      if (!pill) continue;
      pill.ownerId = ps.ownerId;
      if (!ps.alive) {
        if (pill.alive) pill.takeDamage(pill.health);
      } else {
        const owner = ps.ownerId === null ? 'neutral'
          : networkManager.isMyTeam(ps.ownerId) ? 'friendly' : 'enemy';
        if (pill.owner !== owner || !pill.alive) pill.capture(owner);
        pill.health = ps.health;
      }
    }

    // Base states
    ctx.baseManager.applySnapshot(snap.baseStates);

    // Mines + Boats
    ctx.mineSystem.applySnapshot(snap.mines, snap.boats);

    // Pill pickups — rebuild from authoritative snapshot
    for (const p of this.pillPickups) p.sprite.destroy();
    this.pillPickups = [];
    this.pendingPillCollects.clear();
    for (const pu of (snap.pillPickups ?? [])) {
      const sprite = ctx.scene.add.sprite(pu.x, pu.y, 'pill_neutral')
        .setDepth(4).setScale(0.65).setAlpha(0.9);
      this.pillPickups.push({ sprite, id: pu.id });
    }

    // Ghost tank states
    for (const ts of snap.tankStates) {
      if (ts.playerId !== networkManager.playerId) {
        ctx.ghostManager.updateSnapshot(ts);
      }
    }

    // Sync timer
    if (ctx.mpGameStart) {
      ctx.onTimerUpdate(ctx.mpGameStart.settings.timerSeconds * 1000 - snap.timeElapsed);
    }
  }

  /**
   * Check whether the local tank is overlapping a pill pickup.
   * Call every frame from GameScene.update() when !dead.
   */
  checkPillPickup(): void {
    const ctx = this.ctx;
    if (ctx.tank.pillsCarried >= 1) return;
    const tx = ctx.tank.tileX;
    const ty = ctx.tank.tileY;
    const TILE_SIZE_VAL = 32; // matches TILE_SIZE constant
    for (let i = this.pillPickups.length - 1; i >= 0; i--) {
      const { sprite, id } = this.pillPickups[i];
      const ptx = Math.floor(sprite.x / TILE_SIZE_VAL);
      const pty = Math.floor(sprite.y / TILE_SIZE_VAL);
      if (ptx === tx && pty === ty) {
        if (!this.pendingPillCollects.has(id)) {
          this.pendingPillCollects.add(id);
          networkManager.sendPillPickupCollected(id);
        }
        break;
      }
    }
  }

  /** Call every frame from GameScene.update() when dead && spectatorMode. */
  updateSpectator(): void {
    const ctx = this.ctx;
    const aliveIds = ctx.ghostManager.getAlivePlayerIds();
    if (aliveIds.length === 0) {
      ctx.scene.cameras.main.startFollow(ctx.tank.sprite, true, 0.12, 0.12);
      ctx.gameOverUI.spectatorText.setVisible(false);
      return;
    }
    const idx    = ((this.spectatorTargetIdx % aliveIds.length) + aliveIds.length) % aliveIds.length;
    const target = ctx.ghostManager.getSpriteByPlayerId(aliveIds[idx]);
    if (target) ctx.scene.cameras.main.startFollow(target, true, 0.12, 0.12);
    const name = networkManager.players.get(aliveIds[idx])?.name ?? 'Unknown';
    ctx.gameOverUI.spectatorText.setText(`SPECTATING: ${name}   [Q] / [E] to switch`).setVisible(true);
  }

  /** Call from GameScene.shutdown(). */
  shutdown(): void {
    for (const { event, fn } of this._netHandlers) {
      networkManager.off(event as Parameters<typeof networkManager.off>[0], fn as never);
    }
    this._netHandlers = [];
  }

  enterSpectatorMode(): void {
    this._spectatorMode = true;
    this.spectatorTargetIdx = 0;
  }

  exitSpectatorMode(): void {
    this._spectatorMode = false;
  }

  get spectatorMode(): boolean { return this._spectatorMode; }
  get names(): Map<string, string> { return this.playerNames; }

  private _addNetHandler<K extends Parameters<typeof networkManager.on>[0]>(
    event: K,
    fn: Parameters<typeof networkManager.on<K>>[1],
  ): void {
    networkManager.on(event, fn);
    this._netHandlers.push({ event, fn: fn as (d: unknown) => void });
  }

  private _showKillFeed(msg: string): void {
    const ctx = this.ctx;
    const vw  = ctx.scene.scale.width - PANEL_WIDTH;
    const y   = ctx.scene.scale.height - 60 - this.killFeedObjs.length * 18;
    const t   = ctx.scene.add.text(vw - 10, y, msg, {
      fontSize: '11px', color: '#ffdd88',
      backgroundColor: '#00000088',
      padding: { x: 4, y: 2 },
    }).setScrollFactor(0).setDepth(32).setOrigin(1, 1);
    ctx.uiCam.ignore(t);
    this.killFeedObjs.push(t);
    ctx.scene.time.delayedCall(3000, () => {
      t.destroy();
      const i = this.killFeedObjs.indexOf(t);
      if (i >= 0) this.killFeedObjs.splice(i, 1);
    });
  }
}
