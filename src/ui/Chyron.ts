import Phaser from 'phaser';

const HEIGHT = 22;
const SPEED  = 120; // px / s

/**
 * Full-viewport-width scrolling news ticker anchored to the bottom of the
 * game viewport (cameras.main space, scrollFactor 0).
 *
 * The background rectangle is intentionally rendered by BOTH cameras so it
 * spans the full canvas width:
 *   - cameras.main (viewport x=PANEL_WIDTH): renders bg from canvas x=PANEL_WIDTH onward
 *   - uiCam (viewport x=0, w=PANEL_WIDTH): renders bg from canvas x=0 to PANEL_WIDTH
 * Together they give full coverage. The scrolling label is kept in
 * uiCam.ignore() so text only scrolls in the game viewport, not the panel.
 *
 * Usage:
 *   - Call push(msg) to enqueue a message.
 *   - Call update(delta) every frame.
 *   - Pass getIgnored() to uiCam.ignore() after construction (label only).
 *   - Call onResize(vw, fullWidth, vh) from the scene's resize handler.
 */
export class Chyron {
  private readonly bg:      Phaser.GameObjects.Rectangle;
  private readonly topLine: Phaser.GameObjects.Rectangle;
  private readonly label:   Phaser.GameObjects.Text;
  private readonly queue:   string[] = [];
  private scrolling = false;
  private vw: number;

  /**
   * @param vw        Width of the game viewport (canvas width minus panel width).
   *                  Used to position the start of the scrolling text.
   * @param fullWidth Full canvas width — the bg spans this so both cameras
   *                  together cover the entire screen bottom.
   * @param vh        Full canvas height.
   */
  constructor(scene: Phaser.Scene, vw: number, fullWidth: number, vh: number) {
    this.vw = vw;

    // Dark strip — fullWidth so uiCam+cameras.main together cover the full screen.
    this.bg = scene.add.rectangle(0, vh - HEIGHT / 2, fullWidth, HEIGHT, 0x0a0a14)
      .setAlpha(0.94)
      .setScrollFactor(0)
      .setDepth(33)
      .setOrigin(0, 0.5);

    // 1px accent line at the top of the strip — gives it a crisp visible edge.
    this.topLine = scene.add.rectangle(0, vh - HEIGHT, fullWidth, 1, 0x2255aa)
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
  onResize(vw: number, fullWidth: number, vh: number): void {
    this.vw = vw;
    this.bg.setPosition(0, vh - HEIGHT / 2).setSize(fullWidth, HEIGHT);
    this.topLine.setPosition(0, vh - HEIGHT).setSize(fullWidth, 1);
    this.label.setY(vh - HEIGHT / 2);
    if (!this.scrolling) this.label.setX(vw);
  }

  /**
   * Returns [label] — pass to uiCam.ignore() so the left-panel camera does
   * not render the scrolling text. The bg and topLine are intentionally NOT
   * included: they render in both cameras for full-screen coverage.
   */
  getObjects(): Phaser.GameObjects.GameObject[] {
    return [this.label];
  }

  private _start(msg: string): void {
    this.label.setText(msg).setX(this.vw).setVisible(true);
    this.scrolling = true;
  }
}
