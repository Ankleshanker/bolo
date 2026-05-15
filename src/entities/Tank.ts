import Phaser from 'phaser';
import type { InputState } from '../input/InputHandler';

const ROTATE_DEG_PER_SEC = 150;
const ACCEL               = 700;
const MAX_SPEED_GRASS     = 160;
const FRICTION_THRUST     = 0.985;
const FRICTION_COAST      = 0.89;
const FRICTION_BRAKE      = 0.78;
const DIR_SNAP            = 360 / 16; // 22.5° Bolo-style snapping

const MAX_HEALTH  = 10;
const MAX_SHELLS  = 200;
const FIRE_COOLDOWN_MS = 150;
const BARREL_LEN  = 18; // px from center to barrel tip

export class Tank {
  readonly sprite: Phaser.Physics.Arcade.Sprite;
  private facing = 0; // degrees, 0 = north, clockwise

  health       = MAX_HEALTH;
  shells       = MAX_SHELLS;
  alive        = true;
  trees        = 0;
  pillsCarried = 0;
  mines        = 5;

  private fireCooldown = 0;
  private _snapped = 0; // last snapped angle, for barrel tip calc

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.sprite = scene.physics.add.sprite(x, y, 'tank');

    const body = this.body;
    body.setSize(22, 22);
    body.setCollideWorldBounds(false);
    body.allowGravity = false;

    this.sprite.setDepth(5);
    this.sprite.setOrigin(0.5, 0.5);
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }
  get tileX() { return Math.floor(this.sprite.x / 32); }
  get tileY() { return Math.floor(this.sprite.y / 32); }
  get angle() { return this._snapped; }

  /** Returns barrel-tip world position, or null if no shell / on cooldown. */
  tryFire(delta: number): { x: number; y: number; angle: number } | null {
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
    if (this.fireCooldown > 0 || this.shells <= 0) return null;

    this.shells--;
    this.fireCooldown = FIRE_COOLDOWN_MS;

    const rad = Phaser.Math.DegToRad(this._snapped - 90);
    return {
      x:     this.sprite.x + Math.cos(rad) * BARREL_LEN,
      y:     this.sprite.y + Math.sin(rad) * BARREL_LEN,
      angle: this._snapped,
    };
  }

  /** Tick cooldown without firing (call when fire key is NOT held). */
  tickCooldown(delta: number) {
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
  }

  takeDamage(amount = 1): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive  = false;
    }
    return !this.alive; // returns true when just killed
  }

  updateTank(delta: number, input: InputState, terrainSpeed: number) {
    if (!this.alive) return;

    const dt   = delta / 1000;
    const body = this.body;

    if (input.turnLeft)  this.facing -= ROTATE_DEG_PER_SEC * dt;
    if (input.turnRight) this.facing += ROTATE_DEG_PER_SEC * dt;
    this.facing = ((this.facing % 360) + 360) % 360;
    this._snapped = Math.round(this.facing / DIR_SNAP) * DIR_SNAP;
    this.sprite.angle = this._snapped;

    const rad    = Phaser.Math.DegToRad(this._snapped - 90);
    const maxSpd = MAX_SPEED_GRASS * terrainSpeed;

    if (input.thrust && terrainSpeed > 0) {
      body.velocity.x += Math.cos(rad) * ACCEL * dt;
      body.velocity.y += Math.sin(rad) * ACCEL * dt;

      const spd = Math.hypot(body.velocity.x, body.velocity.y);
      if (spd > maxSpd) {
        const inv = maxSpd / spd;
        body.velocity.x *= inv;
        body.velocity.y *= inv;
      }
    }

    const friction = input.brake ? FRICTION_BRAKE
                   : input.thrust ? FRICTION_THRUST
                   : FRICTION_COAST;
    body.velocity.x *= friction;
    body.velocity.y *= friction;

    if (Math.hypot(body.velocity.x, body.velocity.y) < 1) {
      body.velocity.set(0, 0);
    }
  }
}
