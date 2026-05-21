import Phaser from 'phaser';
import { networkManager } from '../network/NetworkManager';
import type { PlayerInfo } from '../network/types';
import { PANEL_WIDTH } from './ActionPanel';

const TEAM_COLORS   = ['#4488ff', '#ff6644', '#44dd88', '#ffdd44'];
const LIST_W        = 128;
const DEPTH         = 31;
const ROW_H         = 18;
const HEADER_H      = 22;
const TEAM_HEADER_H = 20;
const MINIMAP_H     = 128; // must match MinimapSystem.MINI
const MINIMAP_GAP   = 4;   // gutter used by MinimapSystem._objY()

export class PlayerListUI {
  private readonly scene: Phaser.Scene;
  private readonly uiCam: Phaser.Cameras.Scene2D.Camera;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private _collapsed = false;

  constructor(scene: Phaser.Scene, uiCam: Phaser.Cameras.Scene2D.Camera) {
    this.scene  = scene;
    this.uiCam  = uiCam;
  }

  build(): void {
    this.refresh();
    this.scene.scale.on('resize', () => this.refresh());
  }

  refresh(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this._draw();
    this.uiCam.ignore(this.objs);
  }

  destroy(): void {
    for (const o of this.objs) o.destroy();
    this.objs = [];
  }

  /** Total pixel height the list will occupy (used to anchor bottom to minimap top). */
  private _calcHeight(): number {
    const players  = networkManager.players;
    const teamMode = networkManager.settings?.teamMode ?? 'ffa';
    let h = HEADER_H;
    if (!this._collapsed) {
      if (teamMode === 'ffa') {
        h += players.size * ROW_H;
      } else {
        const teamCount = teamMode === '2team' ? 2 : 4;
        const counts = new Array<number>(teamCount).fill(0);
        for (const [, info] of players) {
          if (info.teamIndex >= 0 && info.teamIndex < teamCount) counts[info.teamIndex]++;
        }
        for (let ti = 0; ti < teamCount; ti++) {
          if (counts[ti] > 0) h += TEAM_HEADER_H + counts[ti] * ROW_H;
        }
      }
    }
    return h;
  }

  private _draw(): void {
    const scene   = this.scene;
    const lx      = scene.scale.width - 4 - PANEL_WIDTH;          // left edge mirrors minimap _objX()
    const totalH  = this._calcHeight();
    const startY  = scene.scale.height - MINIMAP_H - MINIMAP_GAP - MINIMAP_GAP - totalH; // sit above minimap
    let curY      = startY;

    // ── Header ────────────────────────────────────────────────────────────────
    const headerLabel = this._collapsed ? 'PLAYERS ▶' : 'PLAYERS ▼';
    const hBg = scene.add.rectangle(lx + LIST_W / 2, curY + HEADER_H / 2, LIST_W, HEADER_H, 0x0d1f33)
      .setStrokeStyle(1, 0x2244aa).setScrollFactor(0).setDepth(DEPTH).setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this._collapsed = !this._collapsed; this.refresh(); });
    const hTxt = scene.add.text(lx + 8, curY + HEADER_H / 2, headerLabel, {
      fontSize: '11px', color: '#aabbcc', fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this._collapsed = !this._collapsed; this.refresh(); });
    this.objs.push(hBg, hTxt);
    curY += HEADER_H;

    if (this._collapsed) return;

    // ── Rows ──────────────────────────────────────────────────────────────────
    const players  = networkManager.players;
    const teamMode = networkManager.settings?.teamMode ?? 'ffa';
    const myId     = networkManager.playerId;

    if (teamMode === 'ffa') {
      for (const [id, info] of players) {
        curY = this._addRow(lx, curY, id, info, myId);
      }
    } else {
      const teamCount = teamMode === '2team' ? 2 : 4;
      const byTeam: PlayerInfo[][] = Array.from({ length: teamCount }, () => []);
      for (const [, info] of players) {
        if (info.teamIndex >= 0 && info.teamIndex < teamCount) {
          byTeam[info.teamIndex].push(info);
        }
      }
      for (let ti = 0; ti < teamCount; ti++) {
        const members = byTeam[ti];
        if (!members || members.length === 0) continue;
        const teamColor = TEAM_COLORS[ti] ?? '#aaaaaa';
        const thBg = scene.add.rectangle(lx + LIST_W / 2, curY + TEAM_HEADER_H / 2, LIST_W, TEAM_HEADER_H, 0x0a1525, 0.8)
          .setScrollFactor(0).setDepth(DEPTH).setOrigin(0.5, 0.5);
        const thTxt = scene.add.text(lx + 8, curY + TEAM_HEADER_H / 2, `TEAM ${ti + 1}`, {
          fontSize: '10px', color: teamColor, fontStyle: 'bold',
        }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5);
        this.objs.push(thBg, thTxt);
        curY += TEAM_HEADER_H;
        for (const info of members) {
          curY = this._addRow(lx, curY, info.playerId, info, myId);
        }
      }
    }

    // ── Background ────────────────────────────────────────────────────────────
    const bg = scene.add.rectangle(lx + LIST_W / 2, startY + totalH / 2, LIST_W, totalH, 0x070f1a, 0.85)
      .setStrokeStyle(1, 0x1a2f44).setScrollFactor(0).setDepth(DEPTH - 1).setOrigin(0.5, 0.5);
    this.objs.push(bg);
  }

  private _addRow(lx: number, y: number, id: string, info: PlayerInfo, myId: string): number {
    const isMe     = id === myId;
    const alpha    = info.connected ? 1 : 0.4;
    const rawName  = info.name ?? 'Unknown';
    const name     = rawName.length > 13 ? rawName.slice(0, 12) + '…' : rawName;
    const label    = isMe ? `${name} [you]` : name;
    const hexStr   = (info.color ?? '#ffffff').replace(/^#/, '');
    const colorVal = parseInt(hexStr, 16) || 0xffffff;
    const colorHex = `#${hexStr}`;

    const dot = this.scene.add.rectangle(lx + 9, y + ROW_H / 2, 6, 6, colorVal)
      .setScrollFactor(0).setDepth(DEPTH + 1).setAlpha(alpha).setOrigin(0.5, 0.5);
    const txt = this.scene.add.text(lx + 18, y + ROW_H / 2, label, {
      fontSize: '11px',
      color:     isMe ? '#ffffff' : colorHex,
      fontStyle: isMe ? 'bold'    : 'normal',
    }).setScrollFactor(0).setDepth(DEPTH + 1).setOrigin(0, 0.5).setAlpha(alpha);

    this.objs.push(dot, txt);
    return y + ROW_H;
  }
}
