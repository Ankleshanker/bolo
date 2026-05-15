import Phaser from 'phaser';
import { CURRENT_SEED } from '../map/ProceduralMap';
import { PANEL_WIDTH } from './ActionPanel';

export const STORAGE_NAME  = 'bolo_player_name';
export const STORAGE_COLOR = 'bolo_team_color';

const TEAM_COLORS = [0xffffff, 0xff4444, 0x4488ff, 0x44dd44, 0xffaa00, 0xdd44ff];

export class SettingsPanel {
  private scene: Phaser.Scene;
  readonly gearObjects: Phaser.GameObjects.GameObject[] = [];

  private overlayObjs: Phaser.GameObjects.GameObject[] = [];
  private _open = false;

  private playerName:    string;
  private selectedColor: number;

  private nameDisplay?:  Phaser.GameObjects.Text;
  private nameFocused  = false;
  private cursorBlink  = 0;
  private cursorOn     = false;
  private colorSwatches: Array<{ obj: Phaser.GameObjects.Rectangle; color: number }> = [];
  private keyHandler?: (e: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene) {
    this.scene         = scene;
    this.playerName    = localStorage.getItem(STORAGE_NAME)  ?? 'Player';
    this.selectedColor = parseInt(localStorage.getItem(STORAGE_COLOR) ?? '0xffffff', 16);

    this.buildGear();
    scene.scale.on('resize', () => this.positionGear());
    scene.input.keyboard!.on('keydown-ESC', () => { if (this._open) this.close(); });
  }

  get isOpen() { return this._open; }

  update(delta: number) {
    if (!this._open || !this.nameFocused || !this.nameDisplay) return;
    this.cursorBlink += delta;
    if (this.cursorBlink >= 500) {
      this.cursorBlink  = 0;
      this.cursorOn     = !this.cursorOn;
      this.refreshNameDisplay();
    }
  }

  private buildGear() {
    const scene = this.scene;
    const bg = scene.add.rectangle(PANEL_WIDTH / 2, 0, 40, 40, 0x1e2e44)
      .setDepth(21)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.toggle())
      .on('pointerover', () => bg.setFillStyle(0x2a3e58))
      .on('pointerout',  () => bg.setFillStyle(this._open ? 0x3a5e78 : 0x1e2e44));

    const icon = scene.add.text(PANEL_WIDTH / 2, 0, '⚙', {
      fontSize: '20px', color: '#cccccc',
    }).setDepth(22).setOrigin(0.5, 0.5);

    this.gearObjects.push(bg, icon);
    this.positionGear();
  }

  private positionGear() {
    const y = this.scene.scale.height - 24;
    (this.gearObjects[0] as Phaser.GameObjects.Rectangle).setY(y);
    (this.gearObjects[1] as Phaser.GameObjects.Text).setY(y);
  }

  private toggle() { this._open ? this.close() : this.open(); }

  open() {
    if (this._open) return;
    this._open = true;
    (this.gearObjects[0] as Phaser.GameObjects.Rectangle).setFillStyle(0x3a5e78);
    this.buildOverlay();
  }

  close() {
    if (!this._open) return;
    this._open      = false;
    this.nameFocused = false;
    this.colorSwatches  = [];
    this.nameDisplay    = undefined;

    if (this.keyHandler) {
      this.scene.input.keyboard!.off('keydown', this.keyHandler as unknown as Function);
      this.keyHandler = undefined;
    }

    for (const obj of this.overlayObjs) obj.destroy();
    this.overlayObjs = [];
    (this.gearObjects[0] as Phaser.GameObjects.Rectangle).setFillStyle(0x1e2e44);
  }

  private push<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.overlayObjs.push(obj);
    return obj;
  }

  private buildOverlay() {
    const scene  = this.scene;
    const vw     = scene.scale.width - PANEL_WIDTH;
    const vh     = scene.scale.height;
    const cx     = vw / 2;
    const cy     = vh / 2;

    // Semi-transparent backdrop (consumes clicks to prevent world interaction)
    this.push(
      scene.add.rectangle(cx, cy, vw, vh, 0x000000, 0.72)
        .setScrollFactor(0).setDepth(50)
        .setInteractive(),
    );

    // Modal box
    const MW = Math.min(400, vw - 40);
    const MH = 400;
    this.push(scene.add.rectangle(cx, cy, MW, MH, 0x1a2a3a)
      .setScrollFactor(0).setDepth(51));
    this.push(scene.add.rectangle(cx, cy, MW, MH)
      .setStrokeStyle(1, 0x445566).setScrollFactor(0).setDepth(51));

    const lx  = cx - MW / 2 + 20;  // left-aligned x
    const D   = 52;
    const labelStyle = { fontSize: '12px', color: '#8899aa' };
    const valueStyle = { fontSize: '13px', color: '#ffffff' };

    // Title
    this.push(scene.add.text(cx, cy - MH / 2 + 18, 'Settings', { fontSize: '16px', color: '#aaddff' })
      .setScrollFactor(0).setDepth(D).setOrigin(0.5, 0));

    // ── Seed ──────────────────────────────────────────────────────────────────
    const seedY = cy - MH / 2 + 62;
    this.push(scene.add.text(lx, seedY, 'Map Seed', labelStyle)
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0.5));
    this.push(scene.add.text(lx + 120, seedY, String(CURRENT_SEED), valueStyle)
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0.5));

    // ── Player Name ───────────────────────────────────────────────────────────
    const nameY = seedY + 52;
    this.push(scene.add.text(lx, nameY, 'Player Name', labelStyle)
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0.5));

    const inputW = 150;
    const inputX = lx + 120;
    const inputBg = this.push(
      scene.add.rectangle(inputX + inputW / 2, nameY, inputW, 26, 0x0c1520)
        .setStrokeStyle(1, 0x334455).setScrollFactor(0).setDepth(D)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.focusName(inputBg))
        .on('pointerover', () => { if (!this.nameFocused) inputBg.setStrokeStyle(1, 0x6699aa); })
        .on('pointerout',  () => { if (!this.nameFocused) inputBg.setStrokeStyle(1, 0x334455); }),
    );

    this.nameDisplay = this.push(
      scene.add.text(inputX + 5, nameY, '', valueStyle)
        .setScrollFactor(0).setDepth(D + 1).setOrigin(0, 0.5),
    );
    this.refreshNameDisplay();

    // ── Team Color ────────────────────────────────────────────────────────────
    const colorY = nameY + 60;
    this.push(scene.add.text(lx, colorY, 'Team Color', labelStyle)
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0.5));

    this.colorSwatches = [];
    TEAM_COLORS.forEach((col, i) => {
      const sx  = lx + 120 + i * 34;
      const swatch = this.push(
        scene.add.rectangle(sx, colorY, 26, 26, col)
          .setScrollFactor(0).setDepth(D)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => this.selectColor(col)),
      );
      swatch.setStrokeStyle(col === this.selectedColor ? 3 : 1,
                            col === this.selectedColor ? 0xffffff : 0x666666);
      this.colorSwatches.push({ obj: swatch, color: col });
    });

    // ── Team Members (Phase 6 placeholder) ────────────────────────────────────
    const teamY = colorY + 60;
    this.push(scene.add.text(lx, teamY, 'Team Members', labelStyle)
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0));
    this.push(scene.add.text(lx, teamY + 20, 'Coming in Phase 6 (Multiplayer)', { fontSize: '11px', color: '#444466' })
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0));

    // ── NPC Tanks (Phase 7 placeholder) ───────────────────────────────────────
    const npcY = teamY + 60;
    this.push(scene.add.text(lx, npcY, 'NPC Tanks', labelStyle)
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0));
    this.push(scene.add.text(lx, npcY + 20, 'Coming in Phase 7 (Polish)', { fontSize: '11px', color: '#444466' })
      .setScrollFactor(0).setDepth(D).setOrigin(0, 0));

    // ── Close button ──────────────────────────────────────────────────────────
    const closeY = cy + MH / 2 - 30;
    const closeBtn = this.push(
      scene.add.rectangle(cx, closeY, 110, 30, 0x2a3e58)
        .setScrollFactor(0).setDepth(D)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.close())
        .on('pointerover', () => closeBtn.setFillStyle(0x3a5e78))
        .on('pointerout',  () => closeBtn.setFillStyle(0x2a3e58)),
    );
    this.push(scene.add.text(cx, closeY, 'Close  [Esc]', { fontSize: '13px', color: '#aaaaaa' })
      .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5, 0.5));
  }

  private focusName(inputBg: Phaser.GameObjects.Rectangle) {
    this.nameFocused = true;
    this.cursorBlink = 0;
    this.cursorOn    = true;
    inputBg.setStrokeStyle(2, 0x88ccff);
    this.refreshNameDisplay();

    if (this.keyHandler) return;
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.nameFocused) return;
      if (e.key === 'Backspace') {
        this.playerName = this.playerName.slice(0, -1);
      } else if (e.key === 'Enter') {
        this.nameFocused = false;
        inputBg.setStrokeStyle(1, 0x334455);
      } else if (e.key.length === 1 && this.playerName.length < 20) {
        this.playerName += e.key;
      }
      localStorage.setItem(STORAGE_NAME, this.playerName);
      this.refreshNameDisplay();
    };
    this.scene.input.keyboard!.on('keydown', this.keyHandler as unknown as Function);
  }

  private refreshNameDisplay() {
    if (!this.nameDisplay) return;
    const cursor = this.nameFocused && this.cursorOn ? '|' : ' ';
    this.nameDisplay.setText(this.playerName + cursor);
  }

  private selectColor(col: number) {
    this.selectedColor = col;
    localStorage.setItem(STORAGE_COLOR, '0x' + col.toString(16).padStart(6, '0'));
    for (const { obj, color } of this.colorSwatches) {
      obj.setStrokeStyle(color === col ? 3 : 1, color === col ? 0xffffff : 0x666666);
    }
  }
}
