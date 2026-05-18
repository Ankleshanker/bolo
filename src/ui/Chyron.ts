import Phaser from 'phaser';

const HEIGHT = 22;
const SPEED  = 120; // px / s

/**
 * Scrolling news ticker anchored to the bottom of the game viewport
 * (cameras.main space only — does NOT overlap the left button panel).
 *
 * All three objects are passed to uiCam.ignore() via getObjects() so the
 * left-panel camera never renders them. cameras.main (viewport x = PANEL_WIDTH)
 * renders them starting at the right edge of the panel.
 *
 * Usage:
 *   - Call push(msg) to enqueue a message.
 *   - Call update(delta) every frame.
 *   - Pass getObjects() to uiCam.ignore() after construction.
 *   - Call onResize(vw, vh) from the scene's resize handler.
 */
export class Chyron {
  private readonly bg:      Phaser.GameObjects.Rectangle;
  private readonly topLine: Phaser.GameObjects.Rectangle;
  private readonly label:   Phaser.GameObjects.Text;
  private readonly queue:   string[] = [];
  private scrolling = false;
  private vw: number;

  constructor(scene: Phaser.Scene, vw: number, vh: number) {
    this.vw = vw;

    // Dark strip across the game viewport (not the panel).
    this.bg = scene.add.rectangle(0, vh - HEIGHT / 2, vw, HEIGHT, 0x0a0a14)
      .setAlpha(0.94)
      .setScrollFactor(0)
      .setDepth(33)
      .setOrigin(0, 0.5);

    // 1px accent line at the top of the strip.
    this.topLine = scene.add.rectangle(0, vh - HEIGHT, vw, 1, 0x2255aa)
      .setAlpha(0.9)
      .setScrollFactor(0)
      .setDepth(34)
      .setOrigin(0, 0);

    // Scrolling label — hidden until first message.
    this.label = scene.add.text(vw, vh - HEIGHT / 2, '', {
      fontSize:   '11px',
      color:      '#ffee99',
      fontFamily: 'monospace',
    })
      .setScrollFactor(0)
      .setDepth(35)
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
    this.topLine.setPosition(0, vh - HEIGHT).setSize(vw, 1);
    this.label.setY(vh - HEIGHT / 2);
    if (!this.scrolling) this.label.setX(vw);
  }

  /**
   * Returns [bg, topLine, label] — pass to uiCam.ignore() so the left-panel
   * camera does not render the chyron at all.
   */
  getObjects(): Phaser.GameObjects.GameObject[] {
    return [this.bg, this.topLine, this.label];
  }

  private _start(msg: string): void {
    this.label.setText(msg).setX(this.vw).setVisible(true);
    this.scrolling = true;
  }
}
