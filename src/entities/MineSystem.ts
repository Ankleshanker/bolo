import Phaser from 'phaser';
import type { MapData } from '../map/MapData';
import type { Tank } from './Tank';
import type { SoundManager } from '../audio/SoundManager';
import type { Chyron } from '../ui/Chyron';
import { networkManager } from '../network/NetworkManager';
import { TILE_SIZE, DisplayTile } from '../map/TileTypes';

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

export class MineSystem {
  private readonly scene: Phaser.Scene;
  private readonly mapData: MapData;
  private readonly tank: Tank;
  private readonly soundManager: SoundManager;
  private readonly chyron: Chyron;
  private readonly setTileFn: (tx: number, ty: number, displayTile: number, broadcast?: boolean) => void;
  private readonly spawnExplosionAtFn: (x: number, y: number, skipSound?: boolean) => void;
  private readonly soundDistFn: (wx: number, wy: number) => number;
  private readonly onTankKilledFn: () => void;
  private readonly multiplayerMode: boolean;

  private mines: MineMarker[] = [];
  private boats: BoatMarker[] = [];
  private _inBoat = false;
  private _activeBoat: BoatMarker | null = null;

  constructor(
    scene: Phaser.Scene,
    mapData: MapData,
    tank: Tank,
    soundManager: SoundManager,
    chyron: Chyron,
    multiplayerMode: boolean,
    setTile: (tx: number, ty: number, displayTile: number, broadcast?: boolean) => void,
    spawnExplosionAt: (x: number, y: number, skipSound?: boolean) => void,
    soundDist: (wx: number, wy: number) => number,
    onTankKilled: () => void,
  ) {
    this.scene            = scene;
    this.mapData          = mapData;
    this.tank             = tank;
    this.soundManager     = soundManager;
    this.chyron           = chyron;
    this.multiplayerMode  = multiplayerMode;
    this.setTileFn        = setTile;
    this.spawnExplosionAtFn = spawnExplosionAt;
    this.soundDistFn      = soundDist;
    this.onTankKilledFn   = onTankKilled;
  }

  /** Call every frame from GameScene.update(). */
  update(dead: boolean): void {
    this.checkBoatInteraction(dead);
    if (!dead) this.checkMines();
  }

  /** Ensure a boat sprite exists at the given tile. */
  ensureBoat(tileX: number, tileY: number): void {
    if (this.boats.some(b => b.tileX === tileX && b.tileY === tileY)) return;
    const sprite = this.scene.add.sprite(
      (tileX + 0.5) * TILE_SIZE, (tileY + 0.5) * TILE_SIZE, 'boat',
    ).setDepth(1);
    this.boats.push({ tileX, tileY, sprite });
  }

  /** Place a mine at the given tile (decrements tank.mines). */
  placeMine(tileX: number, tileY: number): void {
    if (this.tank.mines <= 0) return;
    const tile = this.mapData.terrain[tileY]?.[tileX] ?? DisplayTile.Sea;
    if (tile === DisplayTile.Sea) return;
    if (this.mines.some(m => m.tileX === tileX && m.tileY === tileY)) return;
    this.tank.mines--;
    this.spawnMineSprite(tileX, tileY);
    this.soundManager.playLayMine(this.soundDistFn(
      (tileX + 0.5) * TILE_SIZE, (tileY + 0.5) * TILE_SIZE,
    ));
    if (this.multiplayerMode) networkManager.sendMineAdded(tileX, tileY);
  }

  /** Spawn only the visual mine sprite (no ammo cost). */
  spawnMineSprite(tileX: number, tileY: number): void {
    const sprite = this.scene.add.sprite(
      (tileX + 0.5) * TILE_SIZE, (tileY + 0.5) * TILE_SIZE, 'mine',
    ).setDepth(1);
    this.mines.push({ tileX, tileY, sprite });
  }

  handleMineAdded(d: { tileX: number; tileY: number }): void {
    if (this.mines.some(m => m.tileX === d.tileX && m.tileY === d.tileY)) return;
    const sprite = this.scene.add.sprite(
      (d.tileX + 0.5) * TILE_SIZE, (d.tileY + 0.5) * TILE_SIZE, 'mine',
    ).setDepth(1);
    this.mines.push({ tileX: d.tileX, tileY: d.tileY, sprite });
  }

  handleMineDetonated(d: { tileX: number; tileY: number }): void {
    const i = this.mines.findIndex(m => m.tileX === d.tileX && m.tileY === d.tileY);
    if (i >= 0) { this.mines[i].sprite.destroy(); this.mines.splice(i, 1); }
    this.setTileFn(d.tileX, d.tileY, DisplayTile.Crater, false);
    const cx = (d.tileX + 0.5) * TILE_SIZE;
    const cy = (d.tileY + 0.5) * TILE_SIZE;
    this.soundManager.playMineExplosion(this.soundDistFn(cx, cy));
    this.spawnExplosionAtFn(cx, cy, true);
  }

  handleBoatAdded(d: { tileX: number; tileY: number }): void {
    this.ensureBoat(d.tileX, d.tileY);
  }

  applySnapshot(
    mines: { tileX: number; tileY: number }[],
    boats: { tileX: number; tileY: number }[],
  ): void {
    for (const m of mines) {
      if (this.mines.some(mm => mm.tileX === m.tileX && mm.tileY === m.tileY)) continue;
      const sprite = this.scene.add.sprite(
        (m.tileX + 0.5) * TILE_SIZE, (m.tileY + 0.5) * TILE_SIZE, 'mine',
      ).setDepth(1);
      this.mines.push({ tileX: m.tileX, tileY: m.tileY, sprite });
    }
    for (const b of boats) {
      this.ensureBoat(b.tileX, b.tileY);
    }
  }

  get inBoat(): boolean { return this._inBoat; }
  get activeBoat(): BoatMarker | null { return this._activeBoat; }

  private checkBoatInteraction(dead: boolean): void {
    if (dead) return;
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    const tileVal = this.mapData.terrain[ty]?.[tx] ?? DisplayTile.Sea;
    const onWater = tileVal === DisplayTile.Sea || tileVal === DisplayTile.Shallow;

    if (this._inBoat && this._activeBoat) {
      if (onWater) {
        this._activeBoat.tileX = tx;
        this._activeBoat.tileY = ty;
        this._activeBoat.sprite.setPosition(this.tank.x, this.tank.y);
      } else {
        this._inBoat     = false;
        this._activeBoat = null;
        this.soundManager.playBoatExit();
      }
    } else if (!this._inBoat) {
      for (const boat of this.boats) {
        if (boat.tileX === tx && boat.tileY === ty) {
          this._inBoat     = true;
          this._activeBoat = boat;
          this.soundManager.playBoatEnter();
          break;
        }
      }
    }
  }

  private checkMines(): void {
    const tx = this.tank.tileX;
    const ty = this.tank.tileY;
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      if (m.tileX === tx && m.tileY === ty) {
        const { x, y } = m.sprite;
        m.sprite.destroy();
        this.mines.splice(i, 1);
        this.soundManager.playMineExplosion(this.soundDistFn(x, y));
        this.spawnExplosionAtFn(x, y, true);
        this.setTileFn(m.tileX, m.tileY, DisplayTile.Crater);
        const killed = this.tank.takeDamage(3);
        this.chyron.push('You hit a mine!');
        if (killed) this.scene.time.delayedCall(0, () => this.onTankKilledFn());
        if (this.multiplayerMode) networkManager.sendMineDetonated(m.tileX, m.tileY);
        break;
      }
    }
  }
}
