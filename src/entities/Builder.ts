import Phaser from 'phaser';

const SOLDIER_BASE_SPEED  = 80;    // px/s on normal terrain
const ARRIVE_DIST         = 8;     // px — close enough to count as arrived
const MIN_SPEED_MULT      = 0.3;   // floor so soldier is never completely frozen
const OUTBOUND_TIMEOUT_MS = 10000; // give up and return if destination unreachable

type Phase = 'idle' | 'outbound' | 'returning';

export class Builder {
  private sprite: Phaser.Physics.Arcade.Sprite;
  private _busy  = false;
  private _phase: Phase = 'idle';

  private _targetX        = 0;
  private _targetY        = 0;
  private _outboundTime   = 0;
  private _getReturnPos: (() => { x: number; y: number }) | null = null;
  private _onArrive:     (() => void) | null = null;
  private _getSpeedAt:   (worldX: number, worldY: number) => number;

  constructor(
    scene: Phaser.Scene,
    groundLayer:  Phaser.Tilemaps.TilemapLayer,
    pillboxGroup: Phaser.Physics.Arcade.Group,
    getSpeedAt:   (worldX: number, worldY: number) => number,
  ) {
    this._getSpeedAt = getSpeedAt;

    this.sprite = scene.physics.add.sprite(0, 0, 'soldier')
      .setDepth(7)
      .setVisible(false)
      .setScale(1.5)
      .setActive(false);

    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    body.setCollideWorldBounds(false);

    scene.physics.add.collider(this.sprite, groundLayer);
    scene.physics.add.collider(this.sprite, pillboxGroup);
  }

  get isBusy() { return this._busy; }
  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  /**
   * @param toX/toY      World position of the target tile centre.
   * @param getReturnPos Called each frame on the return trip for live tank pos.
   * @param onArrive     Called when the soldier reaches the target tile.
   */
  dispatch(
    toX: number,
    toY: number,
    getReturnPos: () => { x: number; y: number },
    onArrive: () => void,
  ) {
    if (this._busy) return;
    this._busy = true;

    const { x: fromX, y: fromY } = getReturnPos();
    this.sprite.setPosition(fromX, fromY).setVisible(true).setActive(true);
    (this.sprite.body as Phaser.Physics.Arcade.Body).enable = true;

    this._targetX      = toX;
    this._targetY      = toY;
    this._outboundTime = 0;
    this._getReturnPos = getReturnPos;
    this._onArrive     = onArrive;
    this._phase        = 'outbound';
  }

  update(delta: number) {
    if (this._phase === 'idle') return;

    if (this._phase === 'outbound') {
      this._outboundTime += delta;
      if (this._outboundTime >= OUTBOUND_TIMEOUT_MS) {
        this._phase = 'returning'; // give up without executing onArrive
      }
    }

    const targetX = this._phase === 'outbound'
      ? this._targetX
      : this._getReturnPos!().x;
    const targetY = this._phase === 'outbound'
      ? this._targetY
      : this._getReturnPos!().y;

    const dx   = targetX - this.sprite.x;
    const dy   = targetY - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= ARRIVE_DIST) {
      if (this._phase === 'outbound') {
        this._onArrive!();
        this._phase = 'returning';
      } else {
        this._finish();
      }
      return;
    }

    const speedMult = Math.max(MIN_SPEED_MULT, this._getSpeedAt(this.sprite.x, this.sprite.y));
    const speed     = SOLDIER_BASE_SPEED * speedMult;
    const ratio     = speed / dist;
    (this.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(dx * ratio, dy * ratio);
  }

  cancel() {
    this._finish();
  }

  private _finish() {
    const body = this.sprite.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.enable = false;
    this.sprite.setVisible(false).setActive(false);
    this._phase        = 'idle';
    this._getReturnPos = null;
    this._onArrive     = null;
    this._busy         = false;
  }
}
