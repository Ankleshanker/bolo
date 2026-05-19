import Phaser from 'phaser';
import type { BulletManager } from './Bullet';
import type { PillInfo } from '../map/MapData';
import { STORAGE_COLOR } from '../ui/SettingsPanel';

const SHOOT_RANGE_PX  = 320;
const COOLDOWN_FULL   = 1500; // ms at full health
const COOLDOWN_CRIT   =  400; // ms at 1 HP
const DIR_SNAP        = 360 / 16;
const MAX_HEALTH      = 4;

export type PillOwner = 'neutral' | 'friendly' | 'enemy';

/** A target position passed to pillbox AI. `hidden` = true means the target is
 *  concealed in forest and should be ignored. `playerId` is used by the host
 *  to filter out same-team targets for player-owned pillboxes. */
export interface PillTarget {
  x:         number;
  y:         number;
  hidden?:   boolean;
  playerId?: string;
}

export class Pillbox {
  readonly sprite:      Phaser.Physics.Arcade.Sprite;
  private  crackSprite: Phaser.GameObjects.Sprite;
  owner:   PillOwner;
  health:  number;
  alive    = true;
  /** Raw playerId of the current owner; null = neutral. Used by host AI to
   *  filter same-team targets. Mirrors PillboxState.ownerId from the server. */
  ownerId: string | null = null;

  private facing   = 0;
  private cooldown = 0;

  constructor(scene: Phaser.Scene, info: PillInfo, owner: PillOwner, group: Phaser.Physics.Arcade.Group) {
    this.owner  = owner;
    this.health = MAX_HEALTH;

    this.sprite = group.create(
      (info.x + 0.5) * 32,
      (info.y + 0.5) * 32,
      `pill_${owner}`,
    ) as Phaser.Physics.Arcade.Sprite;

    if (owner === 'friendly') this.applyTeamTint();
    this.sprite.setDepth(3);
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setImmovable(true);
    body.allowGravity = false;
    body.setCircle(12, 4, 4);

    this.crackSprite = scene.add.sprite(this.sprite.x, this.sprite.y, 'pill_cracks')
      .setDepth(4)
      .setAlpha(0);
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  takeDamage(amount = 1): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive  = false;
      this.sprite.setActive(false).setVisible(false);
      this.crackSprite.setVisible(false);
      (this.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    } else {
      // 0 cracks at full health, fully visible at 1 HP
      this.crackSprite.setAlpha((MAX_HEALTH - this.health) / (MAX_HEALTH - 1));
    }
    return !this.alive;
  }

  capture(newOwner: PillOwner) {
    this.owner  = newOwner;
    this.health = MAX_HEALTH;
    this.alive  = true;
    this.sprite.setTexture(`pill_${newOwner}`);
    if (newOwner === 'friendly') this.applyTeamTint();
    else this.sprite.clearTint();
    this.sprite.setActive(true).setVisible(true);
    this.crackSprite.setAlpha(0).setVisible(true);
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = true;
  }

  private applyTeamTint() {
    const stored = localStorage.getItem(STORAGE_COLOR);
    const color  = stored ? parseInt(stored, 16) : 0xffffff;
    this.sprite.setTint(color);
  }

  destroy() {
    this.crackSprite.destroy();
    this.sprite.destroy();
  }

  setFacing(angleDeg: number) {
    this.facing = angleDeg;
    this.sprite.angle = angleDeg;
  }

  fireAt(angleDeg: number, bullets: BulletManager) {
    const rad = Phaser.Math.DegToRad(angleDeg - 90);
    bullets.fire(
      this.x + Math.cos(rad) * 18,
      this.y + Math.sin(rad) * 18,
      angleDeg,
    );
  }

  /**
   * Run pillbox AI for one frame.
   *
   * @param targets  Array of potential targets; pill picks the nearest visible one.
   * @param bullets  BulletManager to fire into, or `null` for rotation-only (no fire).
   * @param onShot   Called when a bullet is actually fired (x, y, angleDeg of bullet origin).
   */
  update(
    delta: number,
    targets: PillTarget[],
    bullets: BulletManager | null,
    onShot?: (x: number, y: number, angleDeg: number) => void,
  ) {
    if (!this.alive) return;

    this.cooldown = Math.max(0, this.cooldown - delta);

    // Pick nearest visible target within range
    let nearest: PillTarget | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (t.hidden) continue;
      const dx   = t.x - this.x;
      const dy   = t.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < nearestDist && dist <= SHOOT_RANGE_PX) {
        nearest     = t;
        nearestDist = dist;
      }
    }
    if (!nearest) return;

    const dx = nearest.x - this.x;
    const dy = nearest.y - this.y;
    const targetAngle = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90;
    this.facing = Phaser.Math.Angle.WrapDegrees(targetAngle);
    const snapped = Math.round(this.facing / DIR_SNAP) * DIR_SNAP;
    this.sprite.angle = snapped;

    if (this.cooldown === 0 && bullets !== null) {
      // Faster shoot as health falls: lerp between COOLDOWN_FULL and COOLDOWN_CRIT
      const t = (this.health - 1) / (MAX_HEALTH - 1); // 1.0 at full, 0.0 at 1 HP
      this.cooldown = COOLDOWN_CRIT + t * (COOLDOWN_FULL - COOLDOWN_CRIT);

      this.fireAt(snapped, bullets);
      onShot?.(this.x, this.y, snapped);
    }
  }
}

export class PillboxManager {
  readonly pills:  Pillbox[] = [];
  readonly group:  Phaser.Physics.Arcade.Group;
  private  scene:  Phaser.Scene;

  constructor(scene: Phaser.Scene, pillInfos: PillInfo[]) {
    this.scene = scene;
    this.group = scene.physics.add.group();

    for (const info of pillInfos) {
      const owner: PillOwner =
        info.owner === 0xFF ? 'neutral' :
        info.owner === 0    ? 'friendly' : 'enemy';
      this.pills.push(new Pillbox(scene, info, owner, this.group));
    }
  }

  addPill(tileX: number, tileY: number, ownerId: string | null = null): Pillbox {
    const info: PillInfo = { x: tileX, y: tileY, owner: 0x00, armour: 15, speed: 4 };
    const pill = new Pillbox(this.scene, info, 'friendly', this.group);
    pill.ownerId = ownerId;
    this.pills.push(pill);
    return pill;
  }

  removePill(pill: Pillbox) {
    const i = this.pills.indexOf(pill);
    if (i !== -1) this.pills.splice(i, 1);
    pill.destroy();
  }

  /**
   * @param targets     Passed to each pill's AI (picks nearest visible).
   * @param bullets     BulletManager, or `null` for rotation-only.
   * @param onShot      Called per-shot: (pillIndex, x, y, angleDeg).
   * @param isTeammate  Optional callback; if provided, targets where
   *                    `isTeammate(pill.ownerId, target.playerId)` is true are
   *                    excluded from that pill's AI (friendly-fire prevention).
   */
  update(
    delta: number,
    targets: PillTarget[],
    bullets: BulletManager | null,
    onShot?: (pillIndex: number, x: number, y: number, angleDeg: number) => void,
    isTeammate?: (pillOwnerId: string | null, targetPlayerId: string | undefined) => boolean,
  ) {
    for (let i = 0; i < this.pills.length; i++) {
      const pill = this.pills[i];
      // Without a team-filter callback (single-player, non-host rotation pass),
      // preserve the original behaviour: friendly pills are inert.
      if (!isTeammate && pill.owner === 'friendly') continue;
      const pillTargets = isTeammate
        ? targets.filter(t => !isTeammate(pill.ownerId, t.playerId))
        : targets;
      pill.update(
        delta, pillTargets, bullets,
        onShot ? (x, y, ang) => onShot(i, x, y, ang) : undefined,
      );
    }
  }

  findBySprite(sprite: Phaser.Physics.Arcade.Sprite): Pillbox | undefined {
    return this.pills.find(p => p.sprite === sprite);
  }
}
