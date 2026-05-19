import Phaser from 'phaser';
import type { MapData } from '../map/MapData';
import type { PillboxManager } from '../entities/Pillbox';
import type { SoundManager } from '../audio/SoundManager';
import type { S2C_GameOver } from '../network/types';
import { networkManager } from '../network/NetworkManager';
import { PANEL_WIDTH } from './ActionPanel';

export class GameOverUI {
  private _gameOver = false;
  private gameOverObjs: Phaser.GameObjects.GameObject[] = [];
  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private _spectatorText!: Phaser.GameObjects.Text;

  private readonly scene: Phaser.Scene;
  private readonly uiCam: Phaser.Cameras.Scene2D.Camera;
  private readonly pillboxes: PillboxManager;
  private readonly mapData: MapData;
  private readonly soundManager: SoundManager;

  constructor(
    scene: Phaser.Scene,
    uiCam: Phaser.Cameras.Scene2D.Camera,
    pillboxes: PillboxManager,
    mapData: MapData,
    soundManager: SoundManager,
  ) {
    this.scene        = scene;
    this.uiCam        = uiCam;
    this.pillboxes    = pillboxes;
    this.mapData      = mapData;
    this.soundManager = soundManager;
  }

  /** Call once during scene create(). */
  build(): void {
    const style = { fontSize: '14px', color: '#ffffff', backgroundColor: '#00000099', padding: { x: 6, y: 4 } };
    this.timerText = this.scene.add.text(0, 8, '', style).setScrollFactor(0).setDepth(30);
    this.scoreText = this.scene.add.text(0, 32, '', style).setScrollFactor(0).setDepth(30);
    this._spectatorText = this.scene.add.text(0, 20, '', {
      fontSize: '12px', color: '#ffdd88', backgroundColor: '#00000099', padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(30).setOrigin(0.5, 0).setVisible(false);
    this._reposition();
    this.scene.scale.on('resize', () => this._reposition());
    this.uiCam.ignore([this.timerText, this.scoreText, this._spectatorText]);
  }

  /** Refreshes the timer and score displays. Call every frame from GameScene.updateHUD(). */
  updateTimerDisplay(gameTimer: number, multiplayerMode: boolean): void {
    const remaining = Math.max(0, gameTimer);
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const score = this.countScore();
    this.timerText.setText(`⏱ ${mins}:${secs.toString().padStart(2, '0')}`);
    this.scoreText.setText(multiplayerMode
      ? `⚑ ${score.friendly}/${score.total}`
      : `⚑ ${score.friendly}/${score.total}`);
  }

  /** SP game over. GameScene must zero tank velocity/body BEFORE calling this. */
  triggerSP(): void {
    this._gameOver = true;
    this.soundManager.playGameOver();
    const score  = this.countScore();
    const vw     = this.scene.scale.width - PANEL_WIDTH;
    const vh     = this.scene.scale.height;
    const cx     = vw / 2;
    const cy     = vh / 2;
    const D      = 60;

    const push = (obj: Phaser.GameObjects.GameObject) => { this.gameOverObjs.push(obj); return obj; };

    push(this.scene.add.rectangle(cx, cy, vw, vh, 0x000000, 0.78).setScrollFactor(0).setDepth(D).setInteractive());
    push(this.scene.add.text(cx, cy - 80, "TIME'S UP", { fontSize: '40px', color: '#ffdd44', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    push(this.scene.add.text(cx, cy - 20, `Final Score: ${score.friendly} / ${score.total} objectives`, { fontSize: '20px', color: '#ffffff' })
      .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    push(this.scene.add.text(cx, cy + 20, `(${Math.round(score.friendly / score.total * 100)}% map control)`, { fontSize: '14px', color: '#aaaaaa' })
      .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));

    const playAgain = push(this.scene.add.rectangle(cx, cy + 80, 180, 44, 0x1a4a1a)
      .setStrokeStyle(2, 0x44aa44).setScrollFactor(0).setDepth(D + 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.scene.start('LobbyScene'))
      .on('pointerover', () => (playAgain as Phaser.GameObjects.Rectangle).setFillStyle(0x2a6a2a))
      .on('pointerout',  () => (playAgain as Phaser.GameObjects.Rectangle).setFillStyle(0x1a4a1a)));
    push(this.scene.add.text(cx, cy + 80, 'PLAY AGAIN', { fontSize: '18px', color: '#88ff88', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(D + 2).setOrigin(0.5));
  }

  /** MP game over. GameScene must zero tank velocity/body BEFORE calling this. */
  triggerMP(d: S2C_GameOver): void {
    if (this._gameOver) return;
    this._gameOver = true;
    this.soundManager.playGameOver();

    const vw = this.scene.scale.width - PANEL_WIDTH;
    const vh = this.scene.scale.height;
    const cx = vw / 2;
    const cy = vh / 2;
    const D  = 60;
    const push = (obj: Phaser.GameObjects.GameObject) => { this.gameOverObjs.push(obj); return obj; };

    const REASON_LABELS: Record<string, string> = {
      timer:      "TIME'S UP",
      domination: 'DOMINATION',
      deathmatch: 'DEATHMATCH OVER',
      lastPlayer: 'LAST TANK STANDING',
    };

    push(this.scene.add.rectangle(cx, cy, vw, vh, 0x000000, 0.80).setScrollFactor(0).setDepth(D).setInteractive());
    push(this.scene.add.text(cx, cy - 120, REASON_LABELS[d.reason] ?? 'GAME OVER', {
      fontSize: '36px', color: '#ffdd44', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));

    if (d.winnerName) {
      push(this.scene.add.text(cx, cy - 70, `Winner: ${d.winnerName}`, { fontSize: '20px', color: '#88ff88' })
        .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    }

    // Score table
    let ty = cy - 30;
    push(this.scene.add.text(cx, ty, 'PLAYER          K    D    OBJ', {
      fontSize: '11px', color: '#556677', fontFamily: 'monospace',
    }).setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
    ty += 18;

    const net = networkManager;
    for (const s of d.scores) {
      const isMe = s.playerId === net.playerId;
      push(this.scene.add.text(cx, ty,
        `${(s.name + '                  ').slice(0, 16)} ${String(s.kills).padStart(4)}${String(s.deaths).padStart(5)}${String(s.objectives).padStart(6)}`,
        { fontSize: '11px', color: isMe ? '#aaffaa' : '#aabbcc', fontFamily: 'monospace' })
        .setScrollFactor(0).setDepth(D + 1).setOrigin(0.5));
      ty += 16;
    }

    const btnY = Math.max(cy + 80, ty + 30);
    const lobbyBtn = push(this.scene.add.rectangle(cx, btnY, 200, 44, 0x1a4a1a)
      .setStrokeStyle(2, 0x44aa44).setScrollFactor(0).setDepth(D + 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        networkManager.leaveRoom();
        this.scene.scene.start('LobbyScene');
      })
      .on('pointerover', () => (lobbyBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x2a6a2a))
      .on('pointerout',  () => (lobbyBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x1a4a1a)));
    push(this.scene.add.text(cx, btnY, 'BACK TO LOBBY', { fontSize: '16px', color: '#88ff88', fontStyle: 'bold' })
      .setScrollFactor(0).setDepth(D + 2).setOrigin(0.5));
  }

  get isGameOver(): boolean { return this._gameOver; }

  /** Reference needed by setupMultiplayer to show/hide the spectator label. */
  get spectatorText(): Phaser.GameObjects.Text { return this._spectatorText; }

  /** Objects that must be ignored by uiCam. */
  get uiIgnoreObjects(): Phaser.GameObjects.GameObject[] {
    return [this.timerText, this.scoreText, this._spectatorText];
  }

  private _reposition(): void {
    const vw = this.scene.scale.width - PANEL_WIDTH;
    this.timerText.setX(vw - 140);
    this.scoreText.setX(vw - 140);
    this._spectatorText?.setX(vw / 2);
  }

  private countScore(): { friendly: number; total: number } {
    const friendlyPills = this.pillboxes.pills.filter(p => p.owner === 'friendly').length;
    const friendlyBases = this.mapData.bases.filter(b => b.owner === 0x00).length;
    return {
      friendly: friendlyPills + friendlyBases,
      total: this.mapData.pills.length + this.mapData.bases.length,
    };
  }
}
