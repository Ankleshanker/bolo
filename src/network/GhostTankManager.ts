import Phaser from 'phaser';
import type { TankState } from './types.ts';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface GhostSnapshot {
  x: number;
  y: number;
  angle: number;
  timestamp: number;
  alive: boolean;
  inForest: boolean;
  health: number;
}

interface GhostTank {
  playerId: string;
  sprite: Phaser.Physics.Arcade.Sprite;
  nameLabel: Phaser.GameObjects.Text;
  healthBar: Phaser.GameObjects.Rectangle;
  healthBarBg: Phaser.GameObjects.Rectangle;
  snapshots: GhostSnapshot[];   // circular buffer, last 3
  interpolated: { x: number; y: number; angle: number };
  ghosted: boolean;             // true = disconnected, show semi-transparent
  teamIndex: number;
  tint: number;
  name: string;
  soldierSprite: Phaser.GameObjects.Sprite | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many milliseconds behind live positions we render to allow lerp. */
const RENDER_DELAY_MS = 100;

/** Maximum snapshots retained per ghost. */
const MAX_SNAPSHOTS   = 3;

/** Pixel width of the health bar shown above each ghost. */
const HEALTH_BAR_WIDTH = 20;
const HEALTH_BAR_HEIGHT = 3;

/** Y offset above the sprite centre for the name label. */
const NAME_LABEL_OFFSET_Y = -24;

/** Y offset above the sprite centre for the health bar. */
const HEALTH_BAR_OFFSET_Y = -15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate angle along the shortest arc (handles 0/360 wrap). */
function lerpAngle(a: number, b: number, t: number): number {
  let delta = ((b - a) % 360 + 360) % 360;
  if (delta > 180) delta -= 360;
  return a + delta * t;
}

/** Map a health value (0–10) to an RGB integer (green → red). */
function healthColor(health: number): number {
  const ratio = Math.max(0, Math.min(1, health / 10));
  const r = Math.round(lerp(255, 0, ratio));
  const g = Math.round(lerp(0, 200, ratio));
  return (r << 16) | (g << 8);
}

// ---------------------------------------------------------------------------
// GhostTankManager
// ---------------------------------------------------------------------------

export class GhostTankManager {
  private scene: Phaser.Scene;
  private ghosts = new Map<string, GhostTank>();

  /** Physics group containing all ghost sprites — use for bullet-overlap detection. */
  readonly group: Phaser.Physics.Arcade.Group;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.group = scene.physics.add.group();
  }

  // ── public API ─────────────────────────────────────────────────────────────

  addGhost(playerId: string, name: string, color: string, teamIndex: number): void {
    if (this.ghosts.has(playerId)) return;

    const hex  = color.replace(/^#/, '');
    const tint = parseInt(hex, 16);

    // Start off-screen until we receive the first real snapshot
    const sprite = this.scene.physics.add.sprite(0, 0, 'tank');
    sprite.setDepth(5);
    sprite.setTint(tint);
    sprite.setVisible(false);  // hidden until first snapshot arrives
    this.group.add(sprite);

    const nameLabel = this.scene.add.text(0, NAME_LABEL_OFFSET_Y, name, {
      fontSize: '10px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    });
    nameLabel.setOrigin(0.5, 1);
    nameLabel.setDepth(6);
    nameLabel.setVisible(false);

    const healthBarBg = this.scene.add.rectangle(0, HEALTH_BAR_OFFSET_Y, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT, 0x555555);
    healthBarBg.setOrigin(0.5, 0.5);
    healthBarBg.setDepth(6);
    healthBarBg.setVisible(false);

    const healthBar = this.scene.add.rectangle(0, HEALTH_BAR_OFFSET_Y, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT, 0x00c800);
    healthBar.setOrigin(0.5, 0.5);
    healthBar.setDepth(6);
    healthBar.setVisible(false);

    const ghost: GhostTank = {
      playerId,
      sprite,
      nameLabel,
      healthBar,
      healthBarBg,
      snapshots: [],
      interpolated: { x: 0, y: 0, angle: 0 },
      ghosted: false,
      teamIndex,
      tint,
      name,
      soldierSprite: null,
    };

    this.ghosts.set(playerId, ghost);
  }

  removeGhost(playerId: string): void {
    const ghost = this.ghosts.get(playerId);
    if (!ghost) return;
    this.group.remove(ghost.sprite);
    ghost.sprite.destroy();
    ghost.nameLabel.destroy();
    ghost.healthBar.destroy();
    ghost.healthBarBg.destroy();
    ghost.soldierSprite?.destroy();
    this.ghosts.delete(playerId);
  }

  updateSnapshot(state: TankState): void {
    const ghost = this.ghosts.get(state.playerId);
    if (!ghost) return;

    const snap: GhostSnapshot = {
      x:         state.x,
      y:         state.y,
      angle:     state.angle,
      timestamp: Date.now(),
      alive:     state.alive,
      inForest:  state.inForest,
      health:    state.health,
    };

    ghost.snapshots.push(snap);
    if (ghost.snapshots.length > MAX_SNAPSHOTS) {
      ghost.snapshots.shift();
    }
  }

  setGhosted(playerId: string, ghosted: boolean): void {
    const ghost = this.ghosts.get(playerId);
    if (!ghost) return;
    ghost.ghosted = ghosted;

    if (ghosted) {
      ghost.nameLabel.setText(`${ghost.name} (DC)`);
    } else {
      ghost.nameLabel.setText(ghost.name);
    }
  }

  /** Call every frame from the scene's update(). */
  update(): void {
    const renderTime = Date.now() - RENDER_DELAY_MS;

    for (const ghost of this.ghosts.values()) {
      const snaps = ghost.snapshots;

      if (snaps.length === 0) continue;

      // --- Determine visibility from alive state of newest snapshot ---
      const newest = snaps[snaps.length - 1];
      const alive  = newest.alive;

      if (!alive) {
        ghost.sprite.setVisible(false);
        ghost.nameLabel.setVisible(false);
        ghost.healthBar.setVisible(false);
        ghost.healthBarBg.setVisible(false);
        continue;
      }

      // --- Interpolate position ---
      let ix: number;
      let iy: number;
      let ia: number;
      let inForest = newest.inForest;
      let health   = newest.health;

      if (snaps.length === 1) {
        // Only one snapshot — snap to it immediately
        ix = snaps[0].x;
        iy = snaps[0].y;
        ia = snaps[0].angle;
        inForest = snaps[0].inForest;
        health   = snaps[0].health;
      } else {
        // Find the two snapshots that bracket renderTime
        let prev = snaps[0];
        let next = snaps[1];

        for (let i = 1; i < snaps.length - 1; i++) {
          if (snaps[i].timestamp <= renderTime && snaps[i + 1].timestamp >= renderTime) {
            prev = snaps[i];
            next = snaps[i + 1];
            break;
          }
          // If renderTime is ahead of all snapshots, use the last two
          if (i === snaps.length - 2) {
            prev = snaps[snaps.length - 2];
            next = snaps[snaps.length - 1];
          }
        }

        const span = next.timestamp - prev.timestamp;
        const t    = span <= 0 ? 1 : Math.max(0, Math.min(1, (renderTime - prev.timestamp) / span));

        ix       = lerp(prev.x, next.x, t);
        iy       = lerp(prev.y, next.y, t);
        ia       = lerpAngle(prev.angle, next.angle, t);
        inForest = t >= 0.5 ? next.inForest : prev.inForest;
        health   = lerp(prev.health, next.health, t);
      }

      ghost.interpolated = { x: ix, y: iy, angle: ia };

      // --- Update sprite ---
      ghost.sprite.setPosition(ix, iy);
      ghost.sprite.setAngle(ia);
      ghost.sprite.setVisible(true);

      if (ghost.ghosted) {
        ghost.sprite.setAlpha(0.35);
      } else {
        ghost.sprite.setAlpha(inForest ? 0.65 : 1);
      }

      // --- Update name label ---
      ghost.nameLabel.setPosition(ix, iy + NAME_LABEL_OFFSET_Y);
      ghost.nameLabel.setVisible(true);

      // --- Update health bar ---
      const hpRatio   = Math.max(0, Math.min(1, health / 10));
      const barWidth  = Math.round(HEALTH_BAR_WIDTH * hpRatio);

      ghost.healthBarBg.setPosition(ix, iy + HEALTH_BAR_OFFSET_Y);
      ghost.healthBarBg.setVisible(true);

      // Reposition foreground bar so it appears left-aligned within the background
      const barX = ix - HEALTH_BAR_WIDTH / 2 + barWidth / 2;
      ghost.healthBar.setPosition(barX, iy + HEALTH_BAR_OFFSET_Y);
      ghost.healthBar.setSize(barWidth > 0 ? barWidth : 0, HEALTH_BAR_HEIGHT);
      ghost.healthBar.setFillStyle(healthColor(health));
      ghost.healthBar.setVisible(true);
    }
  }

  updateSoldier(playerId: string, x: number, y: number, active: boolean): void {
    const ghost = this.ghosts.get(playerId);
    if (!ghost) return;
    if (active) {
      if (!ghost.soldierSprite) {
        ghost.soldierSprite = this.scene.add.sprite(x, y, 'soldier')
          .setDepth(7).setScale(1.5).setTint(ghost.tint);
      }
      ghost.soldierSprite.setPosition(x, y).setVisible(true);
    } else {
      ghost.soldierSprite?.setVisible(false);
    }
  }

  /** Returns positions of all interpolated alive ghosts — for host pillbox targeting. */
  getAlivePositions(): { x: number; y: number; hidden: boolean }[] {
    const out: { x: number; y: number; hidden: boolean }[] = [];
    for (const ghost of this.ghosts.values()) {
      const newest = ghost.snapshots[ghost.snapshots.length - 1];
      if (newest?.alive) {
        out.push({ x: ghost.interpolated.x, y: ghost.interpolated.y, hidden: newest.inForest });
      }
    }
    return out;
  }

  /** Returns all ghost sprites — use for bullet-collision overlap detection. */
  getSprites(): Phaser.Physics.Arcade.Sprite[] {
    return Array.from(this.ghosts.values()).map(g => g.sprite);
  }

  getSpriteByPlayerId(playerId: string): Phaser.Physics.Arcade.Sprite | undefined {
    return this.ghosts.get(playerId)?.sprite;
  }

  /** Reverse lookup: sprite → playerId. Used during bullet-hit detection. */
  getPlayerIdBySprite(sprite: Phaser.Physics.Arcade.Sprite): string | undefined {
    for (const [playerId, ghost] of this.ghosts) {
      if (ghost.sprite === sprite) return playerId;
    }
    return undefined;
  }

  /** Returns all alive playerIds (for spectator camera cycling). */
  getAlivePlayerIds(): string[] {
    const out: string[] = [];
    for (const [playerId, ghost] of this.ghosts) {
      const newest = ghost.snapshots[ghost.snapshots.length - 1];
      if (newest?.alive) out.push(playerId);
    }
    return out;
  }

  /** Destroy all ghost objects and clear state. */
  clear(): void {
    for (const ghost of this.ghosts.values()) {
      this.group.remove(ghost.sprite);
      ghost.sprite.destroy();
      ghost.nameLabel.destroy();
      ghost.healthBar.destroy();
      ghost.healthBarBg.destroy();
      ghost.soldierSprite?.destroy();
    }
    this.ghosts.clear();
  }
}
