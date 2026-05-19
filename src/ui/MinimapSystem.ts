import Phaser from 'phaser';
import type { MapData } from '../map/MapData';
import type { PillboxManager } from '../entities/Pillbox';
import type { GhostTankManager } from '../network/GhostTankManager';
import { networkManager } from '../network/NetworkManager';
import { MAP_SIZE, TILE_SIZE } from '../map/TileTypes';
import { PANEL_WIDTH } from './ActionPanel';

export class MinimapSystem {
  private static readonly MINIMAP_COLORS: number[] = [
    0x007888, 0x009999, 0x050a05, 0x5a3520, 0xa08050,
    0x0a1a0a, 0x7a6a50, 0x2a4a18, 0x4a4a4a, 0x6a6a6a, 0x5a5040,
  ];

  private static readonly MINI = 128;

  private minimapTerrain!: Phaser.GameObjects.Sprite;
  private minimapBlip!: Phaser.GameObjects.Graphics;

  private readonly scene: Phaser.Scene;
  private readonly mapData: MapData;
  private readonly pillboxes: PillboxManager;
  private readonly ghostManager: GhostTankManager | null;

  constructor(
    scene: Phaser.Scene,
    mapData: MapData,
    pillboxes: PillboxManager,
    ghostManager: GhostTankManager | null,
  ) {
    this.scene        = scene;
    this.mapData      = mapData;
    this.pillboxes    = pillboxes;
    this.ghostManager = ghostManager;
  }

  /** Call once during scene create(), after uiCam exists. */
  build(): void {
    const { MINI, MINIMAP_COLORS } = MinimapSystem;
    const gfx = this.scene.make.graphics({ x: 0, y: 0 });
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

    this.minimapTerrain = this.scene.add.sprite(this._objX(), this._objY(), 'minimap_terrain')
      .setScrollFactor(0).setScale(MINI / MAP_SIZE).setOrigin(0, 0).setDepth(90);
    this.minimapBlip = this.scene.add.graphics().setScrollFactor(0).setDepth(91);
  }

  /** Call every frame from GameScene.update(). */
  update(tankX: number, tankY: number, dead: boolean, spectatorMode: boolean, multiplayerMode: boolean): void {
    const { MINI } = MinimapSystem;
    const W    = MAP_SIZE * TILE_SIZE;
    const objX = this._objX();
    const objY = this._objY();

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
      const col = base.owner === 0x00 ? 0x44aaff
                : base.owner === 0x01 ? 0xff4444
                : 0xffffff; // neutral = white
      const mx = objX + ((base.x + 0.5) * TILE_SIZE / W) * MINI;
      const my = objY + ((base.y + 0.5) * TILE_SIZE / W) * MINI;
      this.minimapBlip.fillStyle(col, 0.9);
      this.minimapBlip.fillRect(mx - 1, my - 1, 2, 2);
    }

    // Ghost dots (MP)
    if (multiplayerMode && this.ghostManager) {
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
    if (!dead) {
      const px = objX + (tankX / W) * MINI;
      const py = objY + (tankY / W) * MINI;
      this.minimapBlip.fillStyle(0xffffff, 1);
      this.minimapBlip.fillCircle(px, py, 2);
    }

    this.minimapBlip.lineStyle(1, 0x777777, 0.9);
    this.minimapBlip.strokeRect(objX, objY, MINI, MINI);

    // Spectator overlay
    if (multiplayerMode && dead && spectatorMode) {
      this.minimapBlip.lineStyle(1, 0x4488ff, 0.6);
      this.minimapBlip.strokeRect(objX, objY + MINI + 2, MINI, 14);
      this.minimapBlip.fillStyle(0x00000099);
      this.minimapBlip.fillRect(objX, objY + MINI + 2, MINI, 14);
    }
  }

  /** Call from the resize handler. */
  onResize(): void {
    this.minimapTerrain?.setPosition(this._objX(), this._objY());
  }

  /** Returns game objects that must be ignored by uiCam. */
  get objects(): Phaser.GameObjects.GameObject[] {
    return [this.minimapTerrain, this.minimapBlip];
  }

  private _objX(): number { return this.scene.scale.width  - MinimapSystem.MINI - 4 - PANEL_WIDTH; }
  private _objY(): number { return this.scene.scale.height - MinimapSystem.MINI - 4; }
}
