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

export class Pillbox {
  readonly sprite:      Phaser.Physics.Arcade.Sprite;
  private  crackSprite: Phaser.GameObjects.Sprite;
  owner:  PillOwner;
  health: number;
  alive   = true;

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

  update(
    delta: number,
    targetX: number,
    targetY: number,
    bullets: BulletManager,
    targetHidden = false,
    onShot?: (x: number, y: number, angleDeg: number) => void,
  ) {
    if (!this.alive || this.owner === 'friendly') return;

    this.cooldown = Math.max(0, this.cooldown - delta);

    if (targetHidden) return; // tank is concealed in forest

    const dx   = targetX - this.x;
    const dy   = targetY - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SHOOT_RANGE_PX) return;

    const targetAngle = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) + 90;
    this.facing = Phaser.Math.Angle.WrapDegrees(targetAngle);
    const snapped = Math.round(this.facing / DIR_SNAP) * DIR_SNAP;
    this.sprite.angle = snapped;

    if (this.cooldown === 0) {
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

  addPill(tileX: number, tileY: number): Pillbox {
    const info: PillInfo = { x: tileX, y: tileY, owner: 0x00, armour: 15, speed: 4 };
    const pill = new Pillbox(this.scene, info, 'friendly', this.group);
    this.pills.push(pill);
    return pill;
  }

  removePill(pill: Pillbox) {
    const i = this.pills.indexOf(pill);
    if (i !== -1) this.pills.splice(i, 1);
    pill.destroy();
  }

  update(
    delta: number,
    targets: { x: number; y: number; hidden?: boolean }[],
    bullets: BulletManager,
    onShot?: (x: number, y: number, pillIndex: number, angleDeg: number) => void,
  ) {
    for (let i = 0; i < this.pills.length; i++) {
      const pill = this.pills[i];
      if (targets.length === 0) {
        pill.update(delta, 0, 0, bullets, true);
        continue;
      }
      let nearX = targets[0].x, nearY = targets[0].y, nearHidden = !!targets[0].hidden;
      let nearDist = Math.hypot(targets[0].x - pill.x, targets[0].y - pill.y);
      for (let j = 1; j < targets.length; j++) {
        const d = Math.hypot(targets[j].x - pill.x, targets[j].y - pill.y);
        if (d < nearDist) {
          nearDist = d;
          nearX = targets[j].x;
          nearY = targets[j].y;
          nearHidden = !!targets[j].hidden;
        }
      }
      pill.update(delta, nearX, nearY, bullets, nearHidden,
        (x, y, ang) => onShot?.(x, y, i, ang));
    }
  }

  findBySprite(sprite: Phaser.Physics.Arcade.Sprite): Pillbox | undefined {
    return this.pills.find(p => p.sprite === sprite);
  }
}
