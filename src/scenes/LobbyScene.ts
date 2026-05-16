import Phaser from 'phaser';
import { STORAGE_NAME, STORAGE_COLOR } from '../ui/SettingsPanel';
import { networkManager } from '../network/NetworkManager';
import type { RoomSettings, RoomSummary, PlayerInfo, S2C_GameStart } from '../network/types.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

type LobbyView = 'browse' | 'create' | 'room';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEAM_MODE_LABELS: Record<string, string> = {
  ffa:    'Free for All',
  '2team': '2 Teams',
  '4team': '4 Teams',
};

const WIN_COND_LABELS: Record<string, string> = {
  timer:      'Timer + Objectives',
  domination: 'Domination',
  deathmatch: 'Deathmatch',
};

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  bg:       0x060d18,
  panel:    0x0d1f33,
  panelHi:  0x162d55,
  border:   0x4488ff,
  borderDim: 0x2244aa,
  green:    0x44aa44,
  greenHi:  0x2a6a2a,
  greenBg:  0x1a4a1a,
  red:      0xaa3333,
  text:     '#aaddff',
  textDim:  '#445566',
  textGrey: '#778899',
  white:    '#ffffff',
  gold:     '#ffdd44',
};

export class LobbyScene extends Phaser.Scene {
  // ── solo state ───────────────────────────────────────────────────────────
  private useProcedural = true;
  private seed          = 0;
  private hasMap        = false;
  private procCard!: Phaser.GameObjects.Rectangle;
  private fileCard!: Phaser.GameObjects.Rectangle;
  private seedLabel!: Phaser.GameObjects.Text;

  // ── mode ─────────────────────────────────────────────────────────────────
  private mode: 'solo' | 'multi' = 'solo';
  private view: LobbyView = 'browse';

  // ── mp lobby state ────────────────────────────────────────────────────────
  private roomList: RoomSummary[] = [];
  private mpPlayers: PlayerInfo[] = [];
  private roomNameInput      = '';
  private joinCodeInput      = '';
  private nameInputFocused   = false;
  private codeInputFocused   = false;
  private createSettings: RoomSettings = {
    mapType:      'procedural',
    mapName:      '',
    seed:         0,
    teamMode:     'ffa',
    winCondition: 'timer',
    friendlyFire: false,
    maxPlayers:   8,
    isPublic:     true,
    timerSeconds: 300,
  };

  // ── dynamic containers ────────────────────────────────────────────────────
  private dynamicObjs: Phaser.GameObjects.GameObject[] = [];
  private keydownHandler?: (e: KeyboardEvent) => void;

  // ── layout helpers ────────────────────────────────────────────────────────
  private W  = 0;
  private H  = 0;
  private cx = 0;

  constructor() { super({ key: 'LobbyScene' }); }

  create() {
    this.seed      = Date.now() & 0x00FFFFFF;
    this.hasMap    = this.cache.binary.has('mapdata');
    this.W         = this.scale.width;
    this.H         = this.scale.height;
    this.cx        = this.W / 2;
    this.mode      = 'solo';
    this.view      = 'browse';
    this.roomList  = [];
    this.mpPlayers = [];
    this.dynamicObjs = [];
    this.createSettings.seed = this.seed;

    // ── Background (permanent) ────────────────────────────────────────────
    this.add.rectangle(this.cx, this.H / 2, this.W, this.H, C.bg);
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x112233, 0.25);
    for (let x = 0; x < this.W; x += 40) grid.lineBetween(x, 0, x, this.H);
    for (let y = 0; y < this.H; y += 40) grid.lineBetween(0, y, this.W, y);

    // ── Title ──────────────────────────────────────────────────────────────
    this.add.text(this.cx, this.H * 0.10, 'BOLO', {
      fontSize: '76px', color: '#88ccff', fontStyle: 'bold',
      stroke: '#001133', strokeThickness: 10,
    }).setOrigin(0.5);

    this.add.text(this.cx, this.H * 0.20, 'C L A S S I C   T A N K   C O M B A T', {
      fontSize: '13px', color: '#334455', letterSpacing: 2,
    }).setOrigin(0.5);

    // ── Mode tabs ─────────────────────────────────────────────────────────
    this._buildTabs();

    // ── Initial view ──────────────────────────────────────────────────────
    this._renderSolo();

    // ── Global keyboard handler ───────────────────────────────────────────
    this.keydownHandler = (e: KeyboardEvent) => this._onKey(e);
    window.addEventListener('keydown', this.keydownHandler);

    // ── NetworkManager listeners ──────────────────────────────────────────
    networkManager.on('roomList', d => {
      this.roomList = d.rooms;
      if (this.mode === 'multi' && this.view === 'browse') this._renderMultiBrowse();
    });

    networkManager.on('roomJoined', d => {
      this.view      = 'room';
      this.mpPlayers = d.players;
      if (this.mode === 'multi') this._renderRoom();
    });

    networkManager.on('playerJoined', d => {
      this.mpPlayers = this.mpPlayers.filter(p => p.playerId !== d.player.playerId);
      this.mpPlayers.push(d.player);
      if (this.view === 'room') this._renderRoom();
    });

    networkManager.on('playerRemoved', d => {
      this.mpPlayers = this.mpPlayers.filter(p => p.playerId !== d.playerId);
      if (this.view === 'room') this._renderRoom();
    });

    networkManager.on('playerGhosted', d => {
      const p = this.mpPlayers.find(pp => pp.playerId === d.playerId);
      if (p) p.connected = false;
      if (this.view === 'room') this._renderRoom();
    });

    networkManager.on('playerReconnected', d => {
      const idx = this.mpPlayers.findIndex(p => p.playerId === d.playerId);
      if (idx >= 0) this.mpPlayers[idx] = d.player; else this.mpPlayers.push(d.player);
      if (this.view === 'room') this._renderRoom();
    });

    networkManager.on('settingsUpdated', d => {
      networkManager.settings = d.settings;
      if (this.view === 'room') this._renderRoom();
    });

    networkManager.on('hostChanged', () => {
      if (this.view === 'room') this._renderRoom();
    });

    networkManager.on('error', d => {
      console.warn('[lobby error]', d.message);
    });

    networkManager.on('gameStart', (d: S2C_GameStart) => {
      this._cleanupListeners();
      this.scene.start('GameScene', {
        multiplayerMode: true,
        gameStart: d,
      });
    });
  }

  shutdown() {
    this._cleanupListeners();
  }

  // ─── Key handler ──────────────────────────────────────────────────────────

  private _onKey(e: KeyboardEvent) {
    if (this.nameInputFocused) {
      if (e.key === 'Backspace') { this.roomNameInput = this.roomNameInput.slice(0, -1); this._renderCreate(); }
      else if (e.key.length === 1 && this.roomNameInput.length < 24) { this.roomNameInput += e.key; this._renderCreate(); }
      else if (e.key === 'Enter') { this.nameInputFocused = false; this._renderCreate(); }
      else if (e.key === 'Escape') { this.nameInputFocused = false; this._renderCreate(); }
      return;
    }
    if (this.codeInputFocused) {
      if (e.key === 'Backspace') { this.joinCodeInput = this.joinCodeInput.slice(0, -1); this._renderMultiBrowse(); }
      else if (e.key.length === 1 && this.joinCodeInput.length < 6) { this.joinCodeInput += e.key.toUpperCase(); this._renderMultiBrowse(); }
      else if (e.key === 'Enter') { this._joinByCode(); }
      else if (e.key === 'Escape') { this.codeInputFocused = false; this._renderMultiBrowse(); }
      return;
    }
    if (this.mode === 'solo' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this._startSolo();
    }
  }

  // ─── Tab bar ──────────────────────────────────────────────────────────────

  private soloTab!: Phaser.GameObjects.Rectangle;
  private multiTab!: Phaser.GameObjects.Rectangle;
  private soloTabTxt!: Phaser.GameObjects.Text;
  private multiTabTxt!: Phaser.GameObjects.Text;

  private _buildTabs() {
    const ty  = this.H * 0.27;
    const tw  = 140;
    const th  = 36;
    const gap = 8;

    this.soloTab = this.add.rectangle(this.cx - tw / 2 - gap / 2, ty, tw, th, C.panelHi)
      .setStrokeStyle(1, C.border).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._setMode('solo'));
    this.soloTabTxt = this.add.text(this.cx - tw / 2 - gap / 2, ty, 'SOLO', {
      fontSize: '14px', color: C.text, fontStyle: 'bold',
    }).setOrigin(0.5);

    this.multiTab = this.add.rectangle(this.cx + tw / 2 + gap / 2, ty, tw, th, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._setMode('multi'));
    this.multiTabTxt = this.add.text(this.cx + tw / 2 + gap / 2, ty, 'MULTIPLAYER', {
      fontSize: '14px', color: C.textDim, fontStyle: 'bold',
    }).setOrigin(0.5);
  }

  private _setMode(m: 'solo' | 'multi') {
    if (this.mode === m) return;
    this.mode = m;
    this.view = 'browse';
    this.nameInputFocused = false;
    this.codeInputFocused = false;

    // Update tab styles
    const [activTab, inactTab] = m === 'solo'
      ? [this.soloTab,  this.multiTab]
      : [this.multiTab, this.soloTab];
    const [activTxt, inactTxt] = m === 'solo'
      ? [this.soloTabTxt,  this.multiTabTxt]
      : [this.multiTabTxt, this.soloTabTxt];
    activTab.setFillStyle(C.panelHi).setStrokeStyle(1, C.border);
    inactTab.setFillStyle(C.panel).setStrokeStyle(1, C.borderDim);
    activTxt.setStyle({ color: C.text });
    inactTxt.setStyle({ color: C.textDim });

    this._clearDynamic();
    if (m === 'solo') {
      this._renderSolo();
    } else {
      networkManager.connect();
      networkManager.listRooms();
      this._renderMultiBrowse();
    }
  }

  // ─── Dynamic object management ────────────────────────────────────────────

  private _clearDynamic() {
    for (const obj of this.dynamicObjs) { obj.destroy(); }
    this.dynamicObjs = [];
    this.nameInputFocused = false;
    this.codeInputFocused = false;
  }

  private _push<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.dynamicObjs.push(obj);
    return obj;
  }

  // ─── Solo view ────────────────────────────────────────────────────────────

  private _renderSolo() {
    this._clearDynamic();
    const { cx, H } = this;

    this._push(this.add.text(cx, H * 0.37, 'SELECT MAP', {
      fontSize: '11px', color: C.textDim, letterSpacing: 3,
    }).setOrigin(0.5));

    const CARD_W = 200; const CARD_H = 130; const gap = 16;
    const cardY  = H * 0.48;

    // Procedural card
    this.procCard = this._push(this.add.rectangle(cx - CARD_W / 2 - gap / 2, cardY, CARD_W, CARD_H, C.panel)
      .setStrokeStyle(2, C.border).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._setMapMode(true))
      .on('pointerover', () => { if (!this.useProcedural) this.procCard.setFillStyle(0x0d2a4a); })
      .on('pointerout',  () => { if (!this.useProcedural) this.procCard.setFillStyle(C.panel); })
    ) as Phaser.GameObjects.Rectangle;

    const px = cx - CARD_W / 2 - gap / 2;
    this._push(this.add.text(px, cardY - 38, 'PROCEDURAL MAP', { fontSize: '12px', color: '#aaddff' }).setOrigin(0.5));
    this._push(this.add.text(px, cardY - 18, 'Organic generated landscape', { fontSize: '10px', color: C.textDim }).setOrigin(0.5));
    this._push(this.add.text(px - 60, cardY + 8, 'Seed', { fontSize: '10px', color: '#556677' }).setOrigin(0.5));
    this.seedLabel = this._push(this.add.text(px + 10, cardY + 8, String(this.seed), { fontSize: '12px', color: C.white }).setOrigin(0, 0.5));

    const randBtn = this._push(this.add.rectangle(px + 52, cardY + 8, 56, 20, 0x1a3a6a)
      .setStrokeStyle(1, 0x3366aa).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.seed = (Math.random() * 0xFFFFFF) | 0; this.seedLabel.setText(String(this.seed)); })
      .on('pointerover', () => (randBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x224488))
      .on('pointerout',  () => (randBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x1a3a6a))
    );
    this._push(this.add.text(px + 52, cardY + 8, 'Random', { fontSize: '10px', color: '#aabbcc' }).setOrigin(0.5));

    // File card
    const fx      = cx + CARD_W / 2 + gap / 2;
    const fCol    = this.hasMap ? C.panel : 0x0a0a12;
    const fBord   = this.hasMap ? 0x44aa44 : 0x222233;
    const fTxt    = this.hasMap ? '#aaffaa' : '#333344';

    this.fileCard = this._push(this.add.rectangle(fx, cardY, CARD_W, CARD_H, fCol)
      .setStrokeStyle(2, fBord).setInteractive({ useHandCursor: this.hasMap })
      .on('pointerdown', () => { if (this.hasMap) this._setMapMode(false); })
      .on('pointerover', () => { if (this.hasMap && !this.useProcedural) this.fileCard.setFillStyle(0x0d2a0d); })
      .on('pointerout',  () => { if (this.hasMap && !this.useProcedural) this.fileCard.setFillStyle(C.panel); })
    ) as Phaser.GameObjects.Rectangle;

    this._push(this.add.text(fx, cardY - 38, 'MAP FILE', { fontSize: '12px', color: fTxt }).setOrigin(0.5));
    this._push(this.add.text(fx, cardY - 18, 'Everard Island', { fontSize: '10px', color: C.textDim }).setOrigin(0.5));
    this._push(this.add.text(fx, cardY + 8,
      this.hasMap ? 'Classic layout' : 'No .bmap loaded',
      { fontSize: '11px', color: this.hasMap ? C.textGrey : '#442222' }).setOrigin(0.5));

    // Player name
    const playerName = localStorage.getItem(STORAGE_NAME) ?? 'Player';
    this._push(this.add.text(cx, H * 0.72, `Player: ${playerName}`, { fontSize: '13px', color: C.textDim }).setOrigin(0.5));
    this._push(this.add.text(cx, H * 0.76, '(Change name in Settings ⚙ during game)', { fontSize: '10px', color: '#333344' }).setOrigin(0.5));

    // Start button
    const startY   = H * 0.85;
    const startBtn = this._push(this.add.rectangle(cx, startY, 220, 52, C.greenBg)
      .setStrokeStyle(2, C.green).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._startSolo())
      .on('pointerover', () => (startBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
      .on('pointerout',  () => (startBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
    );
    this._push(this.add.text(cx, startY, '▶  START SOLO', { fontSize: '20px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));
    this._push(this.add.text(cx, H * 0.93, 'WASD / ↑↓←→  Move    Space  Fire    1–5  Builder', { fontSize: '11px', color: '#2a3a4a' }).setOrigin(0.5));

    this._setMapMode(true);
  }

  private _setMapMode(proc: boolean) {
    this.useProcedural = proc;
    this.procCard.setFillStyle(proc ? C.panelHi : C.panel).setStrokeStyle(2, proc ? 0x6699ff : C.borderDim);
    if (this.hasMap) {
      this.fileCard.setFillStyle(!proc ? 0x1a3a1a : C.panel).setStrokeStyle(2, !proc ? 0x66cc66 : C.green);
    }
  }

  private _startSolo() {
    this._cleanupListeners();
    this.scene.start('GameScene', { useProcedural: this.useProcedural, seed: this.seed });
  }

  // ─── Multiplayer: Browse ──────────────────────────────────────────────────

  private _renderMultiBrowse() {
    this._clearDynamic();
    const { cx, H, W } = this;
    const topY = H * 0.35;

    // Section header
    this._push(this.add.text(cx, topY - 24, 'PUBLIC ROOMS', { fontSize: '11px', color: C.textDim, letterSpacing: 3 }).setOrigin(0.5));

    // Refresh button
    const refreshBtn = this._push(this.add.rectangle(W - 80, topY - 24, 100, 22, 0x0d2a4a)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => networkManager.listRooms())
      .on('pointerover', () => (refreshBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (refreshBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x0d2a4a))
    );
    this._push(this.add.text(W - 80, topY - 24, '↻  Refresh', { fontSize: '10px', color: C.textGrey }).setOrigin(0.5));

    // Room list area
    const listH = H * 0.30;
    const listW = W - 80;
    this._push(this.add.rectangle(cx, topY + listH / 2, listW, listH, 0x08121e).setStrokeStyle(1, 0x1a3355));

    if (this.roomList.length === 0) {
      this._push(this.add.text(cx, topY + listH / 2, 'No public rooms — create one!', { fontSize: '12px', color: '#334455' }).setOrigin(0.5));
    } else {
      let ry = topY + 8;
      for (const room of this.roomList.slice(0, 5)) {
        const rowBg = this._push(this.add.rectangle(cx, ry + 14, listW - 16, 30, 0x0d1f33)
          .setStrokeStyle(1, 0x1a3355).setInteractive({ useHandCursor: true })
          .on('pointerover', () => (rowBg as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
          .on('pointerout',  () => (rowBg as Phaser.GameObjects.Rectangle).setFillStyle(0x0d1f33))
          .on('pointerdown', () => this._joinRoom(room.code))
        );
        this._push(this.add.text(40, ry + 14, room.name, { fontSize: '12px', color: C.text }).setOrigin(0, 0.5));
        this._push(this.add.text(cx, ry + 14, `${TEAM_MODE_LABELS[room.settings.teamMode] ?? room.settings.teamMode}  ·  ${WIN_COND_LABELS[room.settings.winCondition] ?? room.settings.winCondition}`, { fontSize: '10px', color: C.textDim }).setOrigin(0.5, 0.5));
        this._push(this.add.text(W - 40, ry + 14, `${room.playerCount}/${room.maxPlayers}`, { fontSize: '11px', color: '#aaffaa' }).setOrigin(1, 0.5));
        ry += 34;
      }
    }

    // Join by code
    const codeY = topY + listH + 24;
    this._push(this.add.text(cx, codeY, 'Join by code:', { fontSize: '11px', color: C.textDim }).setOrigin(0.5));

    this._push(this.add.rectangle(cx - 40, codeY + 22, 130, 28, 0x08121e)
      .setStrokeStyle(1, this.codeInputFocused ? C.border : 0x2244aa)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.codeInputFocused = true; this._renderMultiBrowse(); })
    );
    this._push(this.add.text(cx - 40, codeY + 22, this.joinCodeInput || '_ _ _ _ _ _', {
      fontSize: '14px', color: this.joinCodeInput ? C.white : '#334455', fontStyle: 'bold', letterSpacing: 4,
    }).setOrigin(0.5));

    const joinBtn = this._push(this.add.rectangle(cx + 82, codeY + 22, 70, 28, C.greenBg)
      .setStrokeStyle(1, C.green).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._joinByCode())
      .on('pointerover', () => (joinBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
      .on('pointerout',  () => (joinBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
    );
    this._push(this.add.text(cx + 82, codeY + 22, 'JOIN', { fontSize: '12px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));

    // Click outside code box to unfocus
    this.input.once('pointerdown', (ptr: Phaser.Input.Pointer) => {
      const bx = cx - 40;
      const by = codeY + 22;
      if (Math.abs(ptr.x - bx) > 70 || Math.abs(ptr.y - by) > 14) {
        this.codeInputFocused = false;
      }
    });

    // Create room button
    const createY = codeY + 64;
    const createBtn = this._push(this.add.rectangle(cx, createY, 220, 48, C.panel)
      .setStrokeStyle(2, C.border).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.view = 'create'; this._renderCreate(); })
      .on('pointerover', () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panel))
    );
    this._push(this.add.text(cx, createY, '＋  CREATE ROOM', { fontSize: '16px', color: C.text, fontStyle: 'bold' }).setOrigin(0.5));
  }

  private _joinByCode() {
    const code = this.joinCodeInput.trim().toUpperCase();
    if (code.length < 1) return;
    this._doJoin(code);
  }

  private _joinRoom(code: string) {
    this._doJoin(code);
  }

  private _doJoin(code: string) {
    const name  = localStorage.getItem(STORAGE_NAME)  ?? 'Player';
    const color = localStorage.getItem(STORAGE_COLOR) ?? 'ffffff';
    networkManager.joinRoom(code, name, color);
  }

  // ─── Multiplayer: Create ──────────────────────────────────────────────────

  private _renderCreate() {
    this._clearDynamic();
    const { cx, H } = this;
    const topY = H * 0.34;

    this._push(this.add.text(cx, topY - 10, 'CREATE ROOM', { fontSize: '13px', color: C.textDim, letterSpacing: 3 }).setOrigin(0.5));

    // Room name input
    this._push(this.add.text(cx - 150, topY + 20, 'Room name:', { fontSize: '11px', color: C.textDim }).setOrigin(0, 0.5));
    const nameBox = this._push(this.add.rectangle(cx + 40, topY + 20, 220, 26, 0x08121e)
      .setStrokeStyle(1, this.nameInputFocused ? C.border : 0x2244aa)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.nameInputFocused = true; this._renderCreate(); })
    );
    void nameBox;
    this._push(this.add.text(cx + 40, topY + 20,
      (this.roomNameInput || 'My Room') + (this.nameInputFocused ? '|' : ''),
      { fontSize: '12px', color: this.roomNameInput ? C.white : '#334455' }).setOrigin(0.5));

    let gy = topY + 55;
    const rowH = 30;

    // Map type toggle
    this._push(this.add.text(cx - 150, gy, 'Map:', { fontSize: '11px', color: C.textDim }).setOrigin(0, 0.5));
    const mapProcBtn = this._push(this.add.rectangle(cx + 10, gy, 80, 22,
      this.createSettings.mapType === 'procedural' ? C.panelHi : C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.mapType = 'procedural'; this._renderCreate(); })
    );
    this._push(this.add.text(cx + 10, gy, 'Procedural', { fontSize: '10px', color: C.text }).setOrigin(0.5));
    const mapBmapBtn = this._push(this.add.rectangle(cx + 100, gy, 80, 22,
      this.createSettings.mapType === 'bmap' ? C.panelHi : C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: this.hasMap })
      .on('pointerdown', () => { if (this.hasMap) { this.createSettings.mapType = 'bmap'; this._renderCreate(); } })
    );
    this._push(this.add.text(cx + 100, gy, 'Map file', { fontSize: '10px', color: this.hasMap ? C.text : C.textDim }).setOrigin(0.5));
    void mapProcBtn; void mapBmapBtn;
    gy += rowH;

    // Team mode
    this._push(this.add.text(cx - 150, gy, 'Teams:', { fontSize: '11px', color: C.textDim }).setOrigin(0, 0.5));
    const teamModes: Array<RoomSettings['teamMode']> = ['ffa', '2team', '4team'];
    let bx = cx - 60;
    for (const tm of teamModes) {
      const active = this.createSettings.teamMode === tm;
      const btn = this._push(this.add.rectangle(bx, gy, 80, 22, active ? C.panelHi : C.panel)
        .setStrokeStyle(1, active ? C.border : C.borderDim).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { this.createSettings.teamMode = tm; this._renderCreate(); })
      );
      this._push(this.add.text(bx, gy, TEAM_MODE_LABELS[tm], { fontSize: '9px', color: active ? C.text : C.textGrey }).setOrigin(0.5));
      void btn;
      bx += 84;
    }
    gy += rowH;

    // Win condition
    this._push(this.add.text(cx - 150, gy, 'Win:', { fontSize: '11px', color: C.textDim }).setOrigin(0, 0.5));
    const winConds: Array<RoomSettings['winCondition']> = ['timer', 'domination', 'deathmatch'];
    bx = cx - 60;
    for (const wc of winConds) {
      const active = this.createSettings.winCondition === wc;
      const btn = this._push(this.add.rectangle(bx, gy, 80, 22, active ? C.panelHi : C.panel)
        .setStrokeStyle(1, active ? C.border : C.borderDim).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { this.createSettings.winCondition = wc; this._renderCreate(); })
      );
      this._push(this.add.text(bx, gy, WIN_COND_LABELS[wc].split(' ')[0], { fontSize: '9px', color: active ? C.text : C.textGrey }).setOrigin(0.5));
      void btn;
      bx += 84;
    }
    gy += rowH;

    // Friendly fire
    this._push(this.add.text(cx - 150, gy, 'Friendly Fire:', { fontSize: '11px', color: C.textDim }).setOrigin(0, 0.5));
    const ffActive = this.createSettings.friendlyFire;
    const ffBtn = this._push(this.add.rectangle(cx + 10, gy, 60, 22, ffActive ? 0x3a1010 : C.panel)
      .setStrokeStyle(1, ffActive ? C.red : C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.friendlyFire = !this.createSettings.friendlyFire; this._renderCreate(); })
    );
    this._push(this.add.text(cx + 10, gy, ffActive ? 'ON' : 'OFF', { fontSize: '11px', color: ffActive ? '#ff6666' : C.textGrey }).setOrigin(0.5));
    void ffBtn;
    gy += rowH;

    // Public/Private
    this._push(this.add.text(cx - 150, gy, 'Visibility:', { fontSize: '11px', color: C.textDim }).setOrigin(0, 0.5));
    const pubActive = this.createSettings.isPublic;
    const pubBtn = this._push(this.add.rectangle(cx + 10, gy, 70, 22, pubActive ? C.panelHi : C.panel)
      .setStrokeStyle(1, pubActive ? C.border : C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.isPublic = !this.createSettings.isPublic; this._renderCreate(); })
    );
    this._push(this.add.text(cx + 10, gy, pubActive ? '🔓 Public' : '🔒 Private', { fontSize: '11px', color: C.textGrey }).setOrigin(0.5));
    void pubBtn;
    gy += rowH;

    // Max players
    this._push(this.add.text(cx - 150, gy, 'Max players:', { fontSize: '11px', color: C.textDim }).setOrigin(0, 0.5));
    const decBtn = this._push(this.add.rectangle(cx - 30, gy, 24, 22, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.maxPlayers = Math.max(2, this.createSettings.maxPlayers - 1); this._renderCreate(); })
    );
    this._push(this.add.text(cx - 30, gy, '−', { fontSize: '14px', color: C.text }).setOrigin(0.5));
    this._push(this.add.text(cx + 10, gy, String(this.createSettings.maxPlayers), { fontSize: '13px', color: C.white }).setOrigin(0.5));
    const incBtn = this._push(this.add.rectangle(cx + 50, gy, 24, 22, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.maxPlayers = Math.min(16, this.createSettings.maxPlayers + 1); this._renderCreate(); })
    );
    this._push(this.add.text(cx + 50, gy, '+', { fontSize: '14px', color: C.text }).setOrigin(0.5));
    void decBtn; void incBtn;
    gy += rowH + 6;

    // CREATE button
    const createBtn = this._push(this.add.rectangle(cx, gy, 180, 42, C.greenBg)
      .setStrokeStyle(2, C.green).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._createRoom())
      .on('pointerover', () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
      .on('pointerout',  () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
    );
    this._push(this.add.text(cx, gy, '✓  CREATE', { fontSize: '16px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));

    // Back button
    const backBtn = this._push(this.add.rectangle(cx, gy + 50, 120, 28, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.view = 'browse'; this._renderMultiBrowse(); })
      .on('pointerover', () => (backBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (backBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panel))
    );
    this._push(this.add.text(cx, gy + 50, '← Back', { fontSize: '12px', color: C.textGrey }).setOrigin(0.5));
  }

  private _createRoom() {
    const name  = localStorage.getItem(STORAGE_NAME)  ?? 'Player';
    const color = localStorage.getItem(STORAGE_COLOR) ?? 'ffffff';
    const roomName = this.roomNameInput.trim() || `${name}'s Room`;
    this.createSettings.seed = (Math.random() * 0xFFFFFF) | 0;
    networkManager.createRoom(roomName, { ...this.createSettings }, name, color);
  }

  // ─── Multiplayer: Room Lobby ──────────────────────────────────────────────

  private _renderRoom() {
    this._clearDynamic();
    const { cx, H } = this;
    const topY = H * 0.34;

    const net      = networkManager;
    const code     = net.roomCode;
    const isHost   = net.isHost;
    const players  = [...net.players.values()];
    const settings = net.settings!;

    // Room header
    this._push(this.add.text(cx, topY - 16, settings ? `"${this._truncate(code, 10)}"  CODE: ${code}` : 'Room', {
      fontSize: '11px', color: C.textDim, letterSpacing: 2,
    }).setOrigin(0.5));

    // Copy link hint
    this._push(this.add.text(cx, topY, `Share: bolo.alisted.app?room=${code}`, {
      fontSize: '10px', color: '#2a4a6a',
    }).setOrigin(0.5));

    // Player list
    const listY = topY + 22;
    this._push(this.add.text(cx, listY, 'PLAYERS', { fontSize: '10px', color: C.textDim, letterSpacing: 3 }).setOrigin(0.5));

    let py = listY + 18;
    for (const p of players) {
      const isMe   = p.playerId === net.playerId;
      const colVal = parseInt(p.color.replace(/^#/, ''), 16) || 0xffffff;
      const dot    = this._push(this.add.circle(cx - 130, py + 10, 5, colVal));
      void dot;
      this._push(this.add.text(cx - 120, py + 10,
        `${p.name}${isMe ? ' (you)' : ''}${!p.connected ? ' (DC)' : ''}`,
        { fontSize: '12px', color: p.connected ? C.text : C.textDim }).setOrigin(0, 0.5));

      // Kick button (host only, not self)
      if (isHost && p.playerId !== net.playerId) {
        const kickBtn = this._push(this.add.rectangle(cx + 140, py + 10, 40, 18, 0x2a0808)
          .setStrokeStyle(1, 0x662222).setInteractive({ useHandCursor: true })
          .on('pointerdown', () => { networkManager.kickPlayer(p.playerId); })
          .on('pointerover', () => (kickBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x4a1010))
          .on('pointerout',  () => (kickBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x2a0808))
        );
        this._push(this.add.text(cx + 140, py + 10, 'Kick', { fontSize: '9px', color: '#cc4444' }).setOrigin(0.5));
      }
      py += 22;
    }

    // Settings summary
    if (settings) {
      py = Math.max(py + 8, topY + 140);
      this._push(this.add.text(cx, py, `${TEAM_MODE_LABELS[settings.teamMode] ?? settings.teamMode}  ·  ${WIN_COND_LABELS[settings.winCondition] ?? settings.winCondition}  ·  ${Math.round(settings.timerSeconds / 60)} min`, {
        fontSize: '10px', color: '#334466',
      }).setOrigin(0.5));
      py += 16;
      this._push(this.add.text(cx, py, `Max ${settings.maxPlayers} players  ·  Friendly fire ${settings.friendlyFire ? 'ON' : 'off'}`, {
        fontSize: '10px', color: '#334466',
      }).setOrigin(0.5));
      py += 20;
    }

    // START button (host only)
    if (isHost) {
      const startY   = py + 20;
      const startBtn = this._push(this.add.rectangle(cx, startY, 200, 48, C.greenBg)
        .setStrokeStyle(2, C.green).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => networkManager.startGame())
        .on('pointerover', () => (startBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
        .on('pointerout',  () => (startBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
      );
      this._push(this.add.text(cx, startY, '▶  START GAME', { fontSize: '18px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));
      py = startY + 40;
    } else {
      this._push(this.add.text(cx, py + 20, 'Waiting for host to start…', { fontSize: '13px', color: C.textDim }).setOrigin(0.5));
      py += 40;
    }

    // Leave button
    const leaveBtn = this._push(this.add.rectangle(cx, py + 20, 120, 28, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        networkManager.leaveRoom();
        this.view = 'browse';
        this._renderMultiBrowse();
        networkManager.listRooms();
      })
      .on('pointerover', () => (leaveBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (leaveBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panel))
    );
    this._push(this.add.text(cx, py + 20, '← Leave', { fontSize: '12px', color: C.textGrey }).setOrigin(0.5));
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private _truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  private _cleanupListeners() {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }
    // Remove NM listeners (re-added on next create())
    networkManager.off('roomList',        () => {});
    networkManager.off('roomJoined',      () => {});
    networkManager.off('playerJoined',    () => {});
    networkManager.off('playerRemoved',   () => {});
    networkManager.off('playerGhosted',   () => {});
    networkManager.off('playerReconnected', () => {});
    networkManager.off('settingsUpdated', () => {});
    networkManager.off('hostChanged',     () => {});
    networkManager.off('error',           () => {});
    networkManager.off('gameStart',       () => {});
  }
}
