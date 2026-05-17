import Phaser from 'phaser';

const HEIGHT = 22;
const SPEED  = 120; // px / s

/**
 * Full-viewport-width scrolling news ticker anchored to the bottom of the
 * game viewport (cameras.main space, scrollFactor 0).
 *
 * Usage:
 *   - Call push(msg) to enqueue a message.
 *   - Call update(delta) every frame.
 *   - Pass getObjects() to uiCam.ignore() after construction.
 *   - Call onResize(vw, vh) from the scene's resize handler.
 */
export class Chyron {
  private readonly bg:    Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly queue: string[] = [];
  private scrolling = false;
  private vw: number;

  constructor(scene: Phaser.Scene, vw: number, vh: number) {
    this.vw = vw;

    // Semi-transparent strip — always visible as a permanent fixture
    this.bg = scene.add.rectangle(0, vh - HEIGHT / 2, vw, HEIGHT, 0x111111)
      .setAlpha(0.82)
      .setScrollFactor(0)
      .setDepth(33)
      .setOrigin(0, 0.5);

    // Scrolling label — hidden until first message
    this.label = scene.add.text(vw, vh - HEIGHT / 2, '', {
      fontSize:   '11px',
      color:      '#ffee99',
      fontFamily: 'monospace',
    })
      .setScrollFactor(0)
      .setDepth(34)
      .setOrigin(0, 0.5)
      .setVisible(false);
  }

  /** Enqueue a message. Starts immediately if nothing is scrolling. */
  push(msg: string): void {
    if (!this.scrolling) {
      this._start(msg);
    } else {
      this.queue.push(msg);
    }
  }

  /** Call every frame from GameScene.update(). */
  update(delta: number): void {
    if (!this.scrolling) return;
    this.label.x -= SPEED * (delta / 1000);
    if (this.label.x + this.label.width < 0) {
      if (this.queue.length > 0) {
        this._start(this.queue.shift()!);
      } else {
        this.scrolling = false;
        this.label.setVisible(false);
      }
    }
  }

  /** Call from the scene resize handler whenever the viewport changes. */
  onResize(vw: number, vh: number): void {
    this.vw = vw;
    this.bg.setPosition(0, vh - HEIGHT / 2).setSize(vw, HEIGHT);
    this.label.setY(vh - HEIGHT / 2);
    // If not currently scrolling, reset the label start position too
    if (!this.scrolling) this.label.setX(vw);
  }

  /**
   * Returns [bg, label] — pass to uiCam.ignore() in setupUiCamera() so
   * the left-panel camera does not render the chyron.
   */
  getObjects(): Phaser.GameObjects.GameObject[] {
    return [this.bg, this.label];
  }

  private _start(msg: string): void {
    this.label.setText(msg).setX(this.vw).setVisible(true);
    this.scrolling = true;
  }
}
