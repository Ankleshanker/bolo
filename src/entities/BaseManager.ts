import Phaser from 'phaser';
import type { MapData } from '../map/MapData';
import type { Tank } from './Tank';
import type { SoundManager } from '../audio/SoundManager';
import type { Chyron } from '../ui/Chyron';
import { networkManager } from '../network/NetworkManager';
import { TILE_SIZE } from '../map/TileTypes';
import { STORAGE_COLOR } from '../ui/SettingsPanel';
import type { S2C_BaseUpdate } from '../network/types';

const BASE_MAX_HEALTH         = 4;
const BASE_MAX_SHELLS         = 90;
const BASE_MAX_MINES          = 20;
const BASE_REFUEL_INTERVAL_MS = 1000;
const BASE_REFUEL_SHELLS      = 10;
const BASE_REFUEL_MINES       = 1;
const BASE_SHELLS_PER_MS      = BASE_MAX_SHELLS / (5 * 60 * 1000);
const BASE_MINES_PER_MS       = BASE_MAX_MINES  / (5 * 60 * 1000);

export class BaseManager {
  /** Expose for setupCollision in GameScene. */
  readonly group: Phaser.Physics.Arcade.Group;

  private readonly scene: Phaser.Scene;
  private readonly mapData: MapData;
  private readonly tank: Tank;
  private readonly soundManager: SoundManager;
  private readonly chyron: Chyron;
  private readonly multiplayerMode: boolean;

  private baseRects:    Phaser.GameObjects.Rectangle[]   = [];
  private baseSprites:  Phaser.Physics.Arcade.Sprite[]   = [];
  private baseHealth:   number[]                         = [];
  private baseOwnerIds: (string | null)[]                = [];
  private lastBaseTileX = -1;
  private lastBaseTileY = -1;
  private baseRefuelAccum = 0;

  constructor(
    scene: Phaser.Scene,
    mapData: MapData,
    tank: Tank,
    soundManager: SoundManager,
    chyron: Chyron,
    multiplayerMode: boolean,
  ) {
    this.scene           = scene;
    this.mapData         = mapData;
    this.tank            = tank;
    this.soundManager    = soundManager;
    this.chyron          = chyron;
    this.multiplayerMode = multiplayerMode;
    this.group           = this.scene.physics.add.group();
  }

  /** Call once in GameScene.create() after buildTilemap(). Replaces renderMapObjects(). */
  build(): void {
    this.baseRects    = [];
    this.baseSprites  = [];
    this.baseHealth   = [];
    this.baseOwnerIds = [];

    for (let i = 0; i < this.mapData.bases.length; i++) {
      const base = this.mapData.bases[i];
      const cx = base.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = base.y * TILE_SIZE + TILE_SIZE / 2;
      const neutral = base.owner === 0xFF;

      const rect = this.scene.add.rectangle(cx, cy, 24, 24, this._baseRectColor(base.owner, neutral ? 0 : BASE_MAX_HEALTH)).setDepth(2);
      this.baseRects.push(rect);
      this.scene.add.text(cx, cy, '★', { fontSize: '14px', color: '#000000' }).setDepth(3).setOrigin(0.5);

      const hitSprite = this.scene.physics.add.sprite(cx, cy, 'mine').setAlpha(0).setDepth(2);
      (hitSprite.body as Phaser.Physics.Arcade.Body).setImmovable(true).setSize(24, 24).setOffset(-4, -4);
      hitSprite.setData('baseIndex', i);
      this.group.add(hitSprite);
      this.baseSprites.push(hitSprite);

      this.baseHealth.push(neutral ? 0 : BASE_MAX_HEALTH);
      this.baseOwnerIds.push(null);

      if (neutral) {
        base.shells = 0;
        base.mines  = 0;
      }
    }
  }

  /** Register the playerBullets → base overlap. Call from GameScene.setupCollision(). */
  setupCollision(playerBulletsGroup: Phaser.Physics.Arcade.Group): void {
    this.scene.physics.add.overlap(
      playerBulletsGroup,
      this.group,
      (obj1, obj2) => {
        const isBullet   = playerBulletsGroup.contains(obj1 as Phaser.GameObjects.GameObject);
        const bullet     = (isBullet ? obj1 : obj2) as Phaser.Physics.Arcade.Sprite;
        const baseSprite = (isBullet ? obj2 : obj1) as Phaser.Physics.Arcade.Sprite;
        if (!bullet.active) return;

        const idx  = baseSprite.getData('baseIndex') as number;
        const base = this.mapData.bases[idx];
        if (!base) return;
        if (base.owner === 0x00) return; // can't shoot own base

        // Kill bullet — caller's playerBullets.kill() is called via the group reference
        // We need to kill via the group that owns the bullet.
        bullet.setActive(false).setVisible(false);
        (bullet.body as Phaser.Physics.Arcade.Body).enable = false;

        this.baseHealth[idx] = Math.max(0, this.baseHealth[idx] - 1);
        this.baseRects[idx]?.setFillStyle(this._baseRectColor(
          this.baseHealth[idx] === 0 ? 0xFF : base.owner, this.baseHealth[idx]
        ));

        if (this.baseHealth[idx] === 0) {
          base.owner  = 0xFF;
          base.shells = 0;
          base.mines  = 0;
          this.baseOwnerIds[idx] = null;
          this.chyron.push('A base was neutralized.');
          if (this.multiplayerMode) {
            networkManager.sendBaseUpdate(idx, null, 0, 0, 0);
          }
        } else if (this.multiplayerMode) {
          networkManager.sendBaseUpdate(
            idx, this.baseOwnerIds[idx], this.baseHealth[idx], base.shells, base.mines,
          );
        }
      },
    );
  }

  /** Call every frame from GameScene.update(). */
  update(delta: number, dead: boolean): void {
    if (dead) return;
    this.checkBaseInteraction(delta);
    this.updateBaseSupplies(delta);
  }

  /** Called when a baseUpdate net event arrives. */
  handleNetUpdate(d: S2C_BaseUpdate): void {
    const base = this.mapData.bases[d.index];
    if (!base) return;

    const wasNeutral = base.owner === 0xFF;
    this.baseHealth[d.index] = d.health;
    base.shells = d.shells;
    base.mines  = d.mines;

    if (d.ownerId === null) {
      base.owner = 0xFF;
      this.baseOwnerIds[d.index] = null;
      if (!wasNeutral) this.chyron.push('A base was neutralized.');
    } else if (networkManager.isMyTeam(d.ownerId)) {
      base.owner = 0x00;
      this.baseOwnerIds[d.index] = d.ownerId;
      if (d.ownerId !== networkManager.playerId && wasNeutral) {
        const name = this._playerName(d.ownerId);
        this.chyron.push(`${name} claimed a base.`);
      }
    } else {
      base.owner = 0x01;
      this.baseOwnerIds[d.index] = d.ownerId;
      if (wasNeutral) {
        const name = this._playerName(d.ownerId);
        this.chyron.push(`${name} claimed a base.`);
      }
    }
    this.baseRects[d.index]?.setFillStyle(this._baseRectColor(base.owner, d.health));
  }

  /** Called when applying a full state snapshot. */
  applySnapshot(baseStates: { index: number; ownerId: string | null; health: number; shells: number; mines: number }[]): void {
    for (const bs of baseStates) {
      const base = this.mapData.bases[bs.index];
      if (!base) continue;
      this.baseHealth[bs.index] = bs.health;
      base.shells = bs.shells;
      base.mines  = bs.mines;
      this.baseOwnerIds[bs.index] = bs.ownerId;
      if (bs.ownerId === null) {
        base.owner = 0xFF;
      } else if (networkManager.isMyTeam(bs.ownerId)) {
        base.owner = 0x00;
      } else {
        base.owner = 0x01;
      }
      this.baseRects[bs.index]?.setFillStyle(this._baseRectColor(base.owner, bs.health));
    }
  }

  teamColor(): number {
    const stored = localStorage.getItem(STORAGE_COLOR);
    return stored ? parseInt(stored, 16) : 0x44ff44;
  }

  private checkBaseInteraction(delta: number): void {
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;

    let onBaseIdx = -1;
    for (let i = 0; i < this.mapData.bases.length; i++) {
      const b = this.mapData.bases[i];
      if (b.x === tx && b.y === ty) { onBaseIdx = i; break; }
    }

    if (onBaseIdx === -1) {
      if (this.lastBaseTileX !== -1) {
        this.lastBaseTileX   = -1;
        this.lastBaseTileY   = -1;
        this.baseRefuelAccum = 0;
      }
      return;
    }

    const base = this.mapData.bases[onBaseIdx];

    if (base.owner === 0xFF) {
      if (tx !== this.lastBaseTileX || ty !== this.lastBaseTileY) {
        this.lastBaseTileX = tx;
        this.lastBaseTileY = ty;
        this._captureBase(onBaseIdx);
      }
      return;
    }

    if (base.owner === 0x01) return; // enemy

    // Friendly: continuous refuel while parked
    this.lastBaseTileX    = tx;
    this.lastBaseTileY    = ty;
    this.baseRefuelAccum += delta;

    if (this.baseRefuelAccum >= BASE_REFUEL_INTERVAL_MS) {
      this.baseRefuelAccum -= BASE_REFUEL_INTERVAL_MS;
      this._doBaseRefuel(onBaseIdx);
    }
  }

  private _captureBase(idx: number): void {
    const base = this.mapData.bases[idx];
    base.owner  = 0x00;
    base.shells = 0;
    base.mines  = 0;
    this.baseHealth[idx]   = BASE_MAX_HEALTH;
    this.baseOwnerIds[idx] = this.multiplayerMode ? networkManager.playerId : 'local';
    this.baseRects[idx]?.setFillStyle(this._baseRectColor(0x00, BASE_MAX_HEALTH));
    this.soundManager.playBuildTile();
    this.chyron.push('You claimed a base.');
    if (this.multiplayerMode) {
      networkManager.sendBaseUpdate(idx, networkManager.playerId, BASE_MAX_HEALTH, 0, 0);
    }
  }

  private _doBaseRefuel(idx: number): void {
    const base = this.mapData.bases[idx];
    let refueled = false;

    if (this.tank.health < 10) {
      this.tank.health = Math.min(10, this.tank.health + 1);
      refueled = true;
    }

    if (this.tank.shells < 200 && base.shells > 0) {
      const give = Math.min(BASE_REFUEL_SHELLS, Math.floor(base.shells), 200 - this.tank.shells);
      if (give > 0) { this.tank.shells += give; base.shells -= give; refueled = true; }
    }

    if (this.tank.mines < 20 && base.mines > 0) {
      const give = Math.min(BASE_REFUEL_MINES, Math.floor(base.mines), 20 - this.tank.mines);
      if (give > 0) { this.tank.mines += give; base.mines -= give; refueled = true; }
    }

    if (refueled) {
      this.soundManager.playBaseResupply();
      if (this.multiplayerMode) {
        networkManager.sendBaseUpdate(idx, this.baseOwnerIds[idx], this.baseHealth[idx],
          this.mapData.bases[idx].shells, this.mapData.bases[idx].mines);
      }
    }
  }

  private updateBaseSupplies(delta: number): void {
    for (let i = 0; i < this.mapData.bases.length; i++) {
      const base = this.mapData.bases[i];
      if (base.owner === 0xFF) continue;
      if (base.shells < BASE_MAX_SHELLS) {
        base.shells = Math.min(BASE_MAX_SHELLS, base.shells + BASE_SHELLS_PER_MS * delta);
      }
      if (base.mines < BASE_MAX_MINES) {
        base.mines = Math.min(BASE_MAX_MINES, base.mines + BASE_MINES_PER_MS * delta);
      }
    }
  }

  /** Look up a player name — falls through to a generic string if not found. */
  private _playerName(playerId: string): string {
    return networkManager.players.get(playerId)?.name ?? 'A player';
  }

  private _baseRectColor(ownerCode: number, health: number): number {
    if (ownerCode === 0xFF || health <= 0) return 0xffffff;
    const full = ownerCode === 0x00 ? this.teamColor() : 0xff4444;
    if (health >= BASE_MAX_HEALTH) return full;
    const t  = (BASE_MAX_HEALTH - health) / BASE_MAX_HEALTH;
    const r1 = (full >> 16) & 0xff;
    const g1 = (full >>  8) & 0xff;
    const b1 =  full        & 0xff;
    return (Math.round(r1 + (0xff - r1) * t) << 16)
         | (Math.round(g1 + (0xff - g1) * t) <<  8)
         |  Math.round(b1 + (0xff - b1) * t);
  }
}
