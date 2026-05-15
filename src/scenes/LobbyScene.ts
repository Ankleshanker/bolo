import Phaser from 'phaser';
import { STORAGE_NAME } from '../ui/SettingsPanel';

export class LobbyScene extends Phaser.Scene {
  private useProcedural = true;
  private seed          = 0;
  private playerName    = 'Player';

  // Interactive objects that need refreshing when mode changes
  private procCard!:  Phaser.GameObjects.Rectangle;
  private fileCard!:  Phaser.GameObjects.Rectangle;
  private seedLabel!: Phaser.GameObjects.Text;
  private hasMap      = false;

  constructor() { super({ key: 'LobbyScene' }); }

  create() {
    this.seed       = Date.now() & 0x00FFFFFF;
    this.playerName = localStorage.getItem(STORAGE_NAME) ?? 'Player';
    this.hasMap     = this.cache.binary.has('mapdata');

    const W  = this.scale.width;
    const H  = this.scale.height;
    const cx = W / 2;

    // ── Background ────────────────────────────────────────────────────────────
    this.add.rectangle(cx, H / 2, W, H, 0x060d18);

    const grid = this.add.graphics();
    grid.lineStyle(1, 0x112233, 0.25);
    for (let x = 0; x < W; x += 40) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y < H; y += 40) grid.lineBetween(0, y, W, y);

    // ── Title ─────────────────────────────────────────────────────────────────
    this.add.text(cx, H * 0.14, 'BOLO', {
      fontSize: '76px', color: '#88ccff', fontStyle: 'bold',
      stroke: '#001133', strokeThickness: 10,
    }).setOrigin(0.5);

    this.add.text(cx, H * 0.26, 'C L A S S I C   T A N K   C O M B A T', {
      fontSize: '13px', color: '#334455', letterSpacing: 2,
    }).setOrigin(0.5);

    // ── Map selection ─────────────────────────────────────────────────────────
    this.add.text(cx, H * 0.36, 'SELECT MAP', {
      fontSize: '11px', color: '#445566', letterSpacing: 3,
    }).setOrigin(0.5);

    const CARD_W = 200;
    const CARD_H = 130;
    const gap    = 16;
    const cardY  = H * 0.47;

    // Procedural card
    this.procCard = this.add.rectangle(cx - CARD_W / 2 - gap / 2, cardY, CARD_W, CARD_H, 0x0d1f33)
      .setStrokeStyle(2, 0x4488ff)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.setMode(true))
      .on('pointerover', () => { if (!this.useProcedural) this.procCard.setFillStyle(0x0d2a4a); })
      .on('pointerout',  () => { if (!this.useProcedural) this.procCard.setFillStyle(0x0d1f33); });

    const px = cx - CARD_W / 2 - gap / 2;

    this.add.text(px, cardY - 38, 'PROCEDURAL MAP', { fontSize: '12px', color: '#aaddff' }).setOrigin(0.5);
    this.add.text(px, cardY - 18, 'Organic generated landscape', { fontSize: '10px', color: '#445566' }).setOrigin(0.5);

    this.add.text(px - 60, cardY + 8, 'Seed', { fontSize: '10px', color: '#556677' }).setOrigin(0.5);
    this.seedLabel = this.add.text(px + 10, cardY + 8, String(this.seed), { fontSize: '12px', color: '#ffffff' })
      .setOrigin(0, 0.5);

    const randBtn = this.add.rectangle(px + 52, cardY + 8, 56, 20, 0x1a3a6a)
      .setStrokeStyle(1, 0x3366aa)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.seed = (Math.random() * 0xFFFFFF) | 0; this.seedLabel.setText(String(this.seed)); })
      .on('pointerover', () => randBtn.setFillStyle(0x224488))
      .on('pointerout',  () => randBtn.setFillStyle(0x1a3a6a));
    this.add.text(px + 52, cardY + 8, 'Random', { fontSize: '10px', color: '#aabbcc' }).setOrigin(0.5);

    // File card
    const fx       = cx + CARD_W / 2 + gap / 2;
    const fileCol  = this.hasMap ? 0x0d1f33 : 0x0a0a12;
    const fileBord = this.hasMap ? 0x44aa44 : 0x222233;
    const fileTxt  = this.hasMap ? '#aaffaa' : '#333344';

    this.fileCard = this.add.rectangle(fx, cardY, CARD_W, CARD_H, fileCol)
      .setStrokeStyle(2, fileBord)
      .setInteractive({ useHandCursor: this.hasMap })
      .on('pointerdown', () => { if (this.hasMap) this.setMode(false); })
      .on('pointerover', () => { if (this.hasMap && !this.useProcedural) this.fileCard.setFillStyle(0x0d2a0d); })
      .on('pointerout',  () => { if (this.hasMap && !this.useProcedural) this.fileCard.setFillStyle(0x0d1f33); });

    this.add.text(fx, cardY - 38, 'MAP FILE', { fontSize: '12px', color: fileTxt }).setOrigin(0.5);
    this.add.text(fx, cardY - 18, 'test.bmap', { fontSize: '10px', color: '#445566' }).setOrigin(0.5);
    this.add.text(fx, cardY + 8,
      this.hasMap ? 'Classic layout' : 'No .bmap loaded',
      { fontSize: '11px', color: this.hasMap ? '#778899' : '#442222' }).setOrigin(0.5);

    // ── Player name ───────────────────────────────────────────────────────────
    this.add.text(cx, H * 0.70, `Player: ${this.playerName}`, {
      fontSize: '13px', color: '#556677',
    }).setOrigin(0.5);

    this.add.text(cx, H * 0.74, '(Change name in Settings ⚙ during game)', {
      fontSize: '10px', color: '#333344',
    }).setOrigin(0.5);

    // ── Start button ──────────────────────────────────────────────────────────
    const startY   = H * 0.83;
    const startBtn = this.add.rectangle(cx, startY, 220, 52, 0x1a4a1a)
      .setStrokeStyle(2, 0x44aa44)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.startGame())
      .on('pointerover', () => startBtn.setFillStyle(0x2a6a2a))
      .on('pointerout',  () => startBtn.setFillStyle(0x1a4a1a));

    this.add.text(cx, startY, '▶  START GAME', {
      fontSize: '20px', color: '#88ff88', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, H * 0.91, 'WASD / ↑↓←→  Move    Space  Fire    1 – 5  Builder', {
      fontSize: '11px', color: '#2a3a4a',
    }).setOrigin(0.5);

    // ── Duration note ─────────────────────────────────────────────────────────
    this.add.text(cx, H * 0.95, '5-minute timed match — control the most objectives', {
      fontSize: '10px', color: '#2a3a44',
    }).setOrigin(0.5);

    // Keyboard shortcut
    this.input.keyboard!.once('keydown-ENTER', () => this.startGame());
    this.input.keyboard!.once('keydown-SPACE', () => this.startGame());

    this.setMode(true);
  }

  private setMode(proc: boolean) {
    this.useProcedural = proc;

    // Procedural card highlight
    this.procCard.setFillStyle(proc ? 0x162d55 : 0x0d1f33);
    this.procCard.setStrokeStyle(2, proc ? 0x6699ff : 0x2244aa);

    // File card highlight (only if loaded)
    if (this.hasMap) {
      this.fileCard.setFillStyle(!proc ? 0x1a3a1a : 0x0d1f33);
      this.fileCard.setStrokeStyle(2, !proc ? 0x66cc66 : 0x44aa44);
    }
  }

  private startGame() {
    this.scene.start('GameScene', {
      useProcedural: this.useProcedural,
      seed: this.seed,
    });
  }
}
