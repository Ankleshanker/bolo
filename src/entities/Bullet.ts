import Phaser from 'phaser';

const BULLET_SPEED = 480; // px/s
const BULLET_LIFE  = 1800; // ms before auto-expire

export class BulletManager {
  readonly group: Phaser.Physics.Arcade.Group;

  constructor(scene: Phaser.Scene) {
    this.group = scene.physics.add.group({
      defaultKey: 'bullet',
      maxSize: 80,
      runChildUpdate: false,
    });
  }

  fire(x: number, y: number, angleDeg: number) {
    const b = this.group.get(x, y, 'bullet') as Phaser.Physics.Arcade.Sprite | null;
    if (!b) return;

    b.setActive(true).setVisible(true);
    b.setDepth(6);
    (b.body as Phaser.Physics.Arcade.Body).enable = true;

    const rad = Phaser.Math.DegToRad(angleDeg - 90);
    b.setVelocity(
      Math.cos(rad) * BULLET_SPEED,
      Math.sin(rad) * BULLET_SPEED,
    );
    b.setData('life', BULLET_LIFE);
  }

  update(delta: number) {
    this.group.getChildren().forEach(go => {
      const b = go as Phaser.Physics.Arcade.Sprite;
      if (!b.active) return;
      const life = (b.getData('life') as number) - delta;
      if (life <= 0) this.kill(b);
      else b.setData('life', life);
    });
  }

  kill(b: Phaser.Physics.Arcade.Sprite) {
    b.setActive(false).setVisible(false);
    (b.body as Phaser.Physics.Arcade.Body).enable = false;
    b.setVelocity(0, 0);
  }
}
