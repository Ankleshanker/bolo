import Phaser from 'phaser';
import { STORAGE_NAME, STORAGE_COLOR } from '../ui/SettingsPanel';
import { networkManager } from '../network/NetworkManager';
import type { RoomSettings, RoomSummary, PlayerInfo, S2C_GameStart } from '../network/types.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

type LobbyView = 'browse' | 'create' | 'room';
type SortCol   = 'name' | 'players' | 'teams' | 'mode' | 'access' | 'time';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEAM_MODE_LABELS: Record<string, string> = {
  ffa:    'Free for All',
  '2team': '2 Teams',
  '4team': '4 Teams',
};

const TEAM_MODE_SHORT: Record<string, string> = {
  ffa:    'FFA',
  '2team': '2v2',
  '4team': '4-way',
};

const WIN_COND_LABELS: Record<string, string> = {
  timer:      'Timer + Objectives',
  domination: 'Domination',
  deathmatch: 'Deathmatch',
};

const WIN_COND_SHORT: Record<string, string> = {
  timer:      'Timer',
  domination: 'Dom.',
  deathmatch: 'DM',
};

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  bg:        0x060d18,
  panel:     0x0d1f33,
  panelHi:   0x162d55,
  border:    0x4488ff,
  borderDim: 0x2244aa,
  green:     0x44aa44,
  greenHi:   0x2a6a2a,
  greenBg:   0x1a4a1a,
  red:       0xaa3333,
  text:      '#aaddff',
  textDim:   '#445566',
  textGrey:  '#778899',
  white:     '#ffffff',
  gold:      '#ffdd44',
};

export class LobbyScene extends Phaser.Scene {
  // ── solo state ───────────────────────────────────────────────────────────
  private useProcedural = true;
  private seed          = 0;
  private hasMap        = false;
  private uploadedMapName: string | null = null;
  private uploadedMapData: string | null = null;
  private procCard!: Phaser.GameObjects.Rectangle;
  private fileCard!: Phaser.GameObjects.Rectangle;
  private seedLabel!: Phaser.GameObjects.Text;

  // ── mode ─────────────────────────────────────────────────────────────────
  private mode: 'solo' | 'multi' = 'multi';
  private view: LobbyView = 'browse';

  // ── mp lobby state ────────────────────────────────────────────────────────
  private roomList: RoomSummary[] = [];
  private mpPlayers: PlayerInfo[] = [];
  private roomNameInput       = '';
  private joinCodeInput       = '';
  private pendingAutoJoinCode = '';
  private nameInputFocused = false;
  private codeInputFocused = false;
  private createSettings: RoomSettings = {
    mapType:      'procedural',
    mapName:      '',
    seed:         0,
    teamMode:     'ffa',
    winCondition: 'timer',
    friendlyFire: false,
    maxPlayers:   8,
    isPublic:     true,
    timerSeconds: 600,
  };

  // ── sort / filter state ───────────────────────────────────────────────────
  private sortCol:       SortCol | null = null;
  private sortDir:       'asc' | 'desc' = 'asc';
  private filterAccess:  'all' | 'public' | 'private' = 'all';
  private filterTeams:   Set<string> = new Set();
  private filterMode:    Set<string> = new Set();
  private filterMinSlots = 0;
  private listScrollOffset = 0;

  // ── private-room prompt state ─────────────────────────────────────────────
  private pendingPrivateRoom: RoomSummary | null = null;
  private privateCodeInput    = '';
  private privateCodeFocused  = false;
  private privateCodeError    = '';

  // ── object pools ─────────────────────────────────────────────────────────
  private dynamicObjs:   Phaser.GameObjects.GameObject[] = [];
  private permanentObjs: Phaser.GameObjects.GameObject[] = [];
  private refreshTimer?: Phaser.Time.TimerEvent;
  private wheelHandler?: (...args: unknown[]) => void;
  private keydownHandler?: (e: KeyboardEvent) => void;

  // ── tab refs (rebuilt on resize) ──────────────────────────────────────────
  private soloTab!:    Phaser.GameObjects.Rectangle;
  private multiTab!:   Phaser.GameObjects.Rectangle;
  private soloTabTxt!: Phaser.GameObjects.Text;
  private multiTabTxt!: Phaser.GameObjects.Text;

  // ── layout ────────────────────────────────────────────────────────────────
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
    this.mode      = 'multi';
    this.view      = 'browse';
    this.roomList  = [];
    this.mpPlayers = [];
    this.dynamicObjs   = [];
    this.permanentObjs = [];
    this.createSettings.seed = this.seed;

    // Read ?room= query param for direct-join links
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      this.pendingAutoJoinCode = roomParam.toUpperCase().trim();
      history.replaceState({}, '', window.location.pathname);
    }

    this._buildPermanent();

    // ── Resize ────────────────────────────────────────────────────────────
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.W  = gameSize.width;
      this.H  = gameSize.height;
      this.cx = this.W / 2;
      this._clearPermanent();
      this._buildPermanent();
      this._clearDynamic();
      this._renderCurrentView();
    });

    // ── Initial view ──────────────────────────────────────────────────────
    networkManager.connect();
    networkManager.listRooms();
    this._renderCurrentView();

    // ── Global keyboard handler ───────────────────────────────────────────
    this.keydownHandler = (e: KeyboardEvent) => this._onKey(e);
    window.addEventListener('keydown', this.keydownHandler);

    // ── NetworkManager listeners ──────────────────────────────────────────
    networkManager.on('roomList', d => {
      this.roomList = d.rooms;
      if (this.pendingAutoJoinCode) {
        const code = this.pendingAutoJoinCode;
        this.pendingAutoJoinCode = '';
        this._doJoin(code);
        return;
      }
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
    this.scale.off('resize');
  }

  // ─── Key handler ──────────────────────────────────────────────────────────

  private _onKey(e: KeyboardEvent) {
    if (this.privateCodeFocused) {
      if (e.key === 'Backspace') { this.privateCodeInput = this.privateCodeInput.slice(0, -1); this._renderMultiBrowse(); }
      else if (e.key.length === 1 && this.privateCodeInput.length < 6) { this.privateCodeInput += e.key.toUpperCase(); this._renderMultiBrowse(); }
      else if (e.key === 'Enter') { this._submitPrivateCode(); }
      else if (e.key === 'Escape') { this._closePrivatePrompt(); }
      return;
    }
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

  // ─── Permanent objects ────────────────────────────────────────────────────

  private _buildPermanent() {
    const { cx, W, H } = this;

    // Background
    this._pushP(this.add.rectangle(cx, H / 2, W, H, C.bg));
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x112233, 0.25);
    for (let x = 0; x < W; x += 40) grid.lineBetween(x, 0, x, H);
    for (let y = 0; y < H; y += 40) grid.lineBetween(0, y, W, y);
    this._pushP(grid);

    // Title
    const titleY    = H * 0.10;
    const boloText  = this._pushP(this.add.text(0, titleY, 'BOLO', {
      fontSize: '88px', color: '#88ccff', fontStyle: 'bold',
      stroke: '#001133', strokeThickness: 12,
    }).setOrigin(1, 0.5)) as Phaser.GameObjects.Text;
    const onlineText = this._pushP(this.add.text(0, titleY + 6, 'ONLINE', {
      fontSize: '56px', color: '#ff3333', fontStyle: 'bold italic',
      stroke: '#330000', strokeThickness: 8,
    }).setOrigin(0, 0.5)) as Phaser.GameObjects.Text;
    const totalW = boloText.width + 10 + onlineText.width;
    boloText.setX(cx - totalW / 2 + boloText.width);
    onlineText.setX(cx - totalW / 2 + boloText.width + 10);

    this._pushP(this.add.text(cx, H * 0.20, 'CLASSIC TANK COMBAT', {
      fontSize: '18px', color: '#6699bb', fontStyle: 'bold', letterSpacing: 3,
    }).setOrigin(0.5));

    this._buildTabs();
  }

  private _clearPermanent() {
    for (const obj of this.permanentObjs) { obj.destroy(); }
    this.permanentObjs = [];
  }

  private _pushP<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.permanentObjs.push(obj);
    return obj;
  }

  // ─── View dispatcher ──────────────────────────────────────────────────────

  private _renderCurrentView() {
    if (this.mode === 'solo') {
      this._renderSolo();
    } else if (this.view === 'create') {
      this._renderCreate();
    } else if (this.view === 'room') {
      this._renderRoom();
    } else {
      this._renderMultiBrowse();
    }
  }

  // ─── Tab bar ──────────────────────────────────────────────────────────────

  private _buildTabs() {
    const ty  = this.H * 0.27;
    const tw  = 140;
    const th  = 36;
    const gap = 8;

    // Multiplayer on LEFT, Solo on RIGHT
    this.multiTab = this._pushP(this.add.rectangle(this.cx - tw / 2 - gap / 2, ty, tw, th, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._setMode('multi'))) as Phaser.GameObjects.Rectangle;
    this.multiTabTxt = this._pushP(this.add.text(this.cx - tw / 2 - gap / 2, ty, 'MULTIPLAYER', {
      fontSize: '14px', color: C.textDim, fontStyle: 'bold',
    }).setOrigin(0.5)) as Phaser.GameObjects.Text;

    this.soloTab = this._pushP(this.add.rectangle(this.cx + tw / 2 + gap / 2, ty, tw, th, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._setMode('solo'))) as Phaser.GameObjects.Rectangle;
    this.soloTabTxt = this._pushP(this.add.text(this.cx + tw / 2 + gap / 2, ty, 'SOLO', {
      fontSize: '14px', color: C.textDim, fontStyle: 'bold',
    }).setOrigin(0.5)) as Phaser.GameObjects.Text;

    // Reflect current active mode
    const [activTab, inactTab] = this.mode === 'multi'
      ? [this.multiTab, this.soloTab] : [this.soloTab, this.multiTab];
    const [activTxt, inactTxt] = this.mode === 'multi'
      ? [this.multiTabTxt, this.soloTabTxt] : [this.soloTabTxt, this.multiTabTxt];
    activTab.setFillStyle(C.panelHi).setStrokeStyle(1, C.border);
    inactTab.setFillStyle(C.panel).setStrokeStyle(1, C.borderDim);
    activTxt.setStyle({ color: C.text });
    inactTxt.setStyle({ color: C.textDim });
  }

  private _setMode(m: 'solo' | 'multi') {
    if (this.mode === m) return;
    this.mode = m;
    this.view = 'browse';
    this.nameInputFocused    = false;
    this.codeInputFocused    = false;
    this.pendingPrivateRoom  = null;
    this.privateCodeFocused  = false;
    this.listScrollOffset    = 0;

    const [activTab, inactTab] = m === 'solo'
      ? [this.soloTab,  this.multiTab] : [this.multiTab, this.soloTab];
    const [activTxt, inactTxt] = m === 'solo'
      ? [this.soloTabTxt,  this.multiTabTxt] : [this.multiTabTxt, this.soloTabTxt];
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
    this.refreshTimer?.remove(false);
    this.refreshTimer = undefined;
    if (this.wheelHandler) { this.input.off('wheel', this.wheelHandler); this.wheelHandler = undefined; }
    for (const obj of this.dynamicObjs) { obj.destroy(); }
    this.dynamicObjs = [];
  }

  private _push<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.dynamicObjs.push(obj);
    return obj;
  }

  // ─── Map upload ───────────────────────────────────────────────────────────

  private _triggerMapUpload(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bmap';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const buf = e.target?.result as ArrayBuffer;
        if (!buf) return;
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        this.uploadedMapData = btoa(binary);
        this.uploadedMapName = file.name;
        this.cache.binary.add('mapdata', buf);
        this.hasMap = true;
        this.createSettings.mapType = 'bmap';
        this.createSettings.mapName = file.name;
        if (this.mode === 'solo') this._renderSolo();
        else this._renderCreate();
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  }

  // ─── Solo view ────────────────────────────────────────────────────────────

  private _renderSolo() {
    this._clearDynamic();
    const { cx, H } = this;

    this._push(this.add.text(cx, H * 0.37, 'SELECT MAP', {
      fontSize: '13px', color: C.textDim, letterSpacing: 3,
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
    this._push(this.add.text(px, cardY - 38, 'PROCEDURAL MAP', { fontSize: '14px', color: '#aaddff' }).setOrigin(0.5));
    this._push(this.add.text(px, cardY - 18, 'Organic generated landscape', { fontSize: '13px', color: C.textDim }).setOrigin(0.5));
    this._push(this.add.text(px - 60, cardY + 8, 'Seed', { fontSize: '13px', color: '#556677' }).setOrigin(0.5));
    this.seedLabel = this._push(this.add.text(px + 10, cardY + 8, String(this.seed), { fontSize: '14px', color: C.white }).setOrigin(0, 0.5));

    const randBtn = this._push(this.add.rectangle(px + 52, cardY + 8, 56, 20, 0x1a3a6a)
      .setStrokeStyle(1, 0x3366aa).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.seed = (Math.random() * 0xFFFFFF) | 0; this.seedLabel.setText(String(this.seed)); })
      .on('pointerover', () => (randBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x224488))
      .on('pointerout',  () => (randBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x1a3a6a))
    );
    this._push(this.add.text(px + 52, cardY + 8, 'Random', { fontSize: '13px', color: '#aabbcc' }).setOrigin(0.5));

    // File card
    const fx    = cx + CARD_W / 2 + gap / 2;
    const fCol  = this.hasMap ? C.panel : 0x0a0a12;
    const fBord = this.hasMap ? 0x44aa44 : 0x222233;
    const fTxt  = this.hasMap ? '#aaffaa' : '#333344';

    this.fileCard = this._push(this.add.rectangle(fx, cardY, CARD_W, CARD_H, fCol)
      .setStrokeStyle(2, fBord).setInteractive({ useHandCursor: this.hasMap })
      .on('pointerdown', () => { if (this.hasMap) this._setMapMode(false); })
      .on('pointerover', () => { if (this.hasMap && !this.useProcedural) this.fileCard.setFillStyle(0x0d2a0d); })
      .on('pointerout',  () => { if (this.hasMap && !this.useProcedural) this.fileCard.setFillStyle(C.panel); })
    ) as Phaser.GameObjects.Rectangle;

    this._push(this.add.text(fx, cardY - 38, 'MAP FILE', { fontSize: '14px', color: fTxt }).setOrigin(0.5));
    this._push(this.add.text(fx, cardY - 18, 'Everard Island', { fontSize: '13px', color: C.textDim }).setOrigin(0.5));
    this._push(this.add.text(fx, cardY + 8,
      this.hasMap ? 'Classic layout' : 'No .bmap loaded',
      { fontSize: '13px', color: this.hasMap ? C.textGrey : '#442222' }).setOrigin(0.5));

    const uploadBtn = this._push(this.add.rectangle(fx, cardY + 32, 120, 22, 0x1a2a1a)
      .setStrokeStyle(1, 0x336633).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._triggerMapUpload())
    );
    this._push(this.add.text(fx, cardY + 32, '📁 Upload .bmap', { fontSize: '13px', color: '#88bb88' }).setOrigin(0.5));
    void uploadBtn;

    // Player name
    const playerName = localStorage.getItem(STORAGE_NAME) ?? 'Player';
    this._push(this.add.text(cx, H * 0.72, `Player: ${playerName}`, { fontSize: '15px', color: C.textDim }).setOrigin(0.5));
    this._push(this.add.text(cx, H * 0.76, '(Change name in Settings ⚙ during game)', { fontSize: '13px', color: '#333344' }).setOrigin(0.5));

    // Start button
    const startY   = H * 0.85;
    const startBtn = this._push(this.add.rectangle(cx, startY, 220, 52, C.greenBg)
      .setStrokeStyle(2, C.green).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._startSolo())
      .on('pointerover', () => (startBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
      .on('pointerout',  () => (startBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
    );
    this._push(this.add.text(cx, startY, '▶  START SOLO', { fontSize: '20px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));
    this._push(this.add.text(cx, H * 0.93, 'WASD / ↑↓←→  Move    Space  Fire    1–5  Builder', { fontSize: '13px', color: '#2a3a4a' }).setOrigin(0.5));

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

    // ── Join by code ──────────────────────────────────────────────────────
    this._push(this.add.text(cx, topY, 'Join by code:', { fontSize: '13px', color: C.textDim }).setOrigin(0.5));

    this._push(this.add.rectangle(cx - 40, topY + 22, 130, 28, 0x08121e)
      .setStrokeStyle(1, this.codeInputFocused ? C.border : 0x2244aa)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.codeInputFocused = true; this._renderMultiBrowse(); })
    );
    this._push(this.add.text(cx - 40, topY + 22, this.joinCodeInput || '_ _ _ _ _ _', {
      fontSize: '16px', color: this.joinCodeInput ? C.white : '#334455', fontStyle: 'bold', letterSpacing: 4,
    }).setOrigin(0.5));

    const joinBtn = this._push(this.add.rectangle(cx + 82, topY + 22, 70, 28, C.greenBg)
      .setStrokeStyle(1, C.green).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._joinByCode())
      .on('pointerover', () => (joinBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
      .on('pointerout',  () => (joinBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
    );
    this._push(this.add.text(cx + 82, topY + 22, 'JOIN', { fontSize: '14px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));

    this.input.once('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (Math.abs(ptr.x - (cx - 40)) > 70 || Math.abs(ptr.y - (topY + 22)) > 14) {
        this.codeInputFocused = false;
      }
    });

    // ── Create room ───────────────────────────────────────────────────────
    const createY = topY + 68;
    const createBtn = this._push(this.add.rectangle(cx, createY, 220, 48, C.panel)
      .setStrokeStyle(2, C.border).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.view = 'create'; this._renderCreate(); })
      .on('pointerover', () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panel))
    );
    this._push(this.add.text(cx, createY, '＋  CREATE ROOM', { fontSize: '18px', color: C.text, fontStyle: 'bold' }).setOrigin(0.5));

    // ── Active Games ──────────────────────────────────────────────────────
    const pubY = createY + 52;
    this._push(this.add.text(cx, pubY, 'ACTIVE GAMES', { fontSize: '13px', color: C.textDim, letterSpacing: 3 }).setOrigin(0.5));

    const refreshBtn = this._push(this.add.rectangle(W - 80, pubY, 100, 22, 0x0d2a4a)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => networkManager.listRooms())
      .on('pointerover', () => (refreshBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (refreshBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x0d2a4a))
    );
    this._push(this.add.text(W - 80, pubY, '↻  Refresh', { fontSize: '13px', color: C.textGrey }).setOrigin(0.5));

    const listW    = W - 80;
    const listLeft = 40;

    // ── Filter bar ────────────────────────────────────────────────────────
    const filterY = pubY + 18;
    this._renderFilterBar(filterY, listLeft, listW);

    // ── List panel ────────────────────────────────────────────────────────
    const listTop = filterY + 28;
    const listH   = Math.max(60, H - listTop - 16);

    const colName    = listLeft + 8;
    const colPlayers = listLeft + listW * 0.42;
    const colTeams   = listLeft + listW * 0.54;
    const colMode    = listLeft + listW * 0.66;
    const colLock    = listLeft + listW * 0.80;
    const colTime    = listLeft + listW - 8;

    this._push(this.add.rectangle(cx, listTop + listH / 2, listW, listH, 0x08121e).setStrokeStyle(1, 0x1a3355));

    // Sortable column headers
    const hdrY = listTop + 11;
    const makeHdr = (x: number, label: string, col: SortCol, originX: number) => {
      const isActive = this.sortCol === col;
      const arrow    = isActive ? (this.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      const color    = isActive ? C.gold : '#556677';
      const txt      = this._push(this.add.text(x, hdrY, label + arrow, {
        fontSize: '11px', color, fontStyle: isActive ? 'bold' : 'normal',
      }).setOrigin(originX, 0.5).setInteractive({ useHandCursor: true }));
      txt.on('pointerover', () => txt.setStyle({ color: isActive ? C.gold : C.textGrey }));
      txt.on('pointerout',  () => txt.setStyle({ color }));
      txt.on('pointerdown', () => {
        if (this.sortCol !== col) { this.sortCol = col; this.sortDir = 'asc'; }
        else if (this.sortDir === 'asc') { this.sortDir = 'desc'; }
        else { this.sortCol = null; }
        this.listScrollOffset = 0;
        this._renderMultiBrowse();
      });
    };
    makeHdr(colName,    'ROOM',    'name',    0);
    makeHdr(colPlayers, 'PLAYERS', 'players', 0.5);
    makeHdr(colTeams,   'TEAMS',   'teams',   0.5);
    makeHdr(colMode,    'MODE',    'mode',    0.5);
    makeHdr(colLock,    'ACCESS',  'access',  0.5);
    makeHdr(colTime,    'TIME',    'time',    1);

    // Divider below header
    const divG = this.add.graphics();
    divG.lineStyle(1, 0x1a3355, 1);
    divG.lineBetween(listLeft + 8, listTop + 20, listLeft + listW - 8, listTop + 20);
    this._push(divG);

    // ── Rows ─────────────────────────────────────────────────────────────
    const displayRooms  = this._getDisplayRooms();
    const rowH          = 28;
    const hdrHeight     = 22;
    const availH        = listH - hdrHeight;
    const visibleCount  = Math.max(1, Math.floor(availH / (rowH + 2)));
    const maxOffset     = Math.max(0, displayRooms.length - visibleCount);
    if (this.listScrollOffset > maxOffset) this.listScrollOffset = maxOffset;

    if (displayRooms.length === 0) {
      const msg = this.roomList.length === 0 ? 'No active games — create one!' : 'No rooms match current filters.';
      this._push(this.add.text(cx, listTop + hdrHeight + availH / 2, msg, { fontSize: '14px', color: '#334455' }).setOrigin(0.5));
    } else {
      const endIdx = Math.min(this.listScrollOffset + visibleCount, displayRooms.length);
      let ry = listTop + hdrHeight;

      for (let i = this.listScrollOffset; i < endIdx; i++) {
        const room      = displayRooms[i];
        const isPrivate = !room.settings.isPublic;
        const rowBg     = this._push(this.add.rectangle(cx, ry + rowH / 2, listW - 16, rowH, 0x0d1f33)
          .setStrokeStyle(1, 0x1a3355).setInteractive({ useHandCursor: true })
          .on('pointerover', () => (rowBg as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
          .on('pointerout',  () => (rowBg as Phaser.GameObjects.Rectangle).setFillStyle(0x0d1f33))
          .on('pointerdown', () => {
            if (isPrivate) {
              this.pendingPrivateRoom = room;
              this.privateCodeInput   = '';
              this.privateCodeFocused = true;
              this.privateCodeError   = '';
              this._renderMultiBrowse();
            } else {
              this._doJoin(room.code);
            }
          })
        );

        const rowMid  = ry + rowH / 2;
        const playing = room.state === 'PLAYING';
        this._push(this.add.text(colName,    rowMid, room.name,                                                    { fontSize: '13px', color: C.text    }).setOrigin(0,   0.5));
        this._push(this.add.text(colPlayers, rowMid, `${room.playerCount}/${room.maxPlayers}`,                     { fontSize: '13px', color: '#aaffaa' }).setOrigin(0.5, 0.5));
        this._push(this.add.text(colTeams,   rowMid, TEAM_MODE_SHORT[room.settings.teamMode]    ?? room.settings.teamMode,    { fontSize: '13px', color: C.textGrey }).setOrigin(0.5, 0.5));
        this._push(this.add.text(colMode,    rowMid, WIN_COND_SHORT[room.settings.winCondition]  ?? room.settings.winCondition, { fontSize: '13px', color: C.textGrey }).setOrigin(0.5, 0.5));
        this._push(this.add.text(colLock,    rowMid, isPrivate ? '🔒' : '🔓',                                     { fontSize: '13px', color: C.textGrey }).setOrigin(0.5, 0.5));
        this._push(this.add.text(colTime,    rowMid, playing ? this._formatTime(room.timeRemainingMs) : 'Lobby',   { fontSize: '13px', color: playing ? '#ffdd88' : C.textDim }).setOrigin(1, 0.5));

        ry += rowH + 2;
      }

      // Scroll controls (shown when list overflows)
      if (displayRooms.length > visibleCount) {
        const scrollX   = listLeft + listW - 4;
        const scrollTop = listTop + hdrHeight;
        const scrollBot = listTop + listH - 4;

        const canUp   = this.listScrollOffset > 0;
        const canDown = this.listScrollOffset < maxOffset;

        const upTxt = this._push(this.add.text(scrollX, scrollTop + 10, '▲', {
          fontSize: '14px', color: canUp ? C.text : '#1a3355',
        }).setOrigin(1, 0.5));
        if (canUp) {
          upTxt.setInteractive({ useHandCursor: true })
            .on('pointerdown', () => { this.listScrollOffset--; this._renderMultiBrowse(); });
        }

        this._push(this.add.text(scrollX, (scrollTop + scrollBot) / 2,
          `${this.listScrollOffset + 1}–${endIdx}/${displayRooms.length}`,
          { fontSize: '10px', color: '#334455' }).setOrigin(1, 0.5));

        const downTxt = this._push(this.add.text(scrollX, scrollBot - 10, '▼', {
          fontSize: '14px', color: canDown ? C.text : '#1a3355',
        }).setOrigin(1, 0.5));
        if (canDown) {
          downTxt.setInteractive({ useHandCursor: true })
            .on('pointerdown', () => { this.listScrollOffset++; this._renderMultiBrowse(); });
        }
      }
    }

    // Mousewheel scroll
    this.wheelHandler = (ptr: unknown, _go: unknown, _dx: unknown, deltaY: unknown) => {
      const p = ptr as Phaser.Input.Pointer;
      if (p.y >= listTop && p.y <= listTop + listH) {
        const maxOff = Math.max(0, displayRooms.length - visibleCount);
        this.listScrollOffset = Phaser.Math.Clamp(
          this.listScrollOffset + ((deltaY as number) > 0 ? 1 : -1), 0, maxOff,
        );
        this._renderMultiBrowse();
      }
    };
    this.input.on('wheel', this.wheelHandler);

    // ── Auto-refresh every 5 s ────────────────────────────────────────────
    this.refreshTimer = this.time.addEvent({ delay: 5000, callback: () => networkManager.listRooms(), loop: true });

    // ── Private room code prompt (rendered last = on top) ─────────────────
    if (this.pendingPrivateRoom) this._renderPrivatePrompt();
  }

  // ─── Active Games helpers ─────────────────────────────────────────────────

  private _getDisplayRooms(): RoomSummary[] {
    let rooms = [...this.roomList];
    if (this.filterAccess === 'public')  rooms = rooms.filter(r =>  r.settings.isPublic);
    if (this.filterAccess === 'private') rooms = rooms.filter(r => !r.settings.isPublic);
    if (this.filterTeams.size > 0)       rooms = rooms.filter(r => this.filterTeams.has(r.settings.teamMode));
    if (this.filterMode.size > 0)        rooms = rooms.filter(r => this.filterMode.has(r.settings.winCondition));
    if (this.filterMinSlots > 0)         rooms = rooms.filter(r => r.playerCount >= this.filterMinSlots);

    if (this.sortCol !== null) {
      const col = this.sortCol;
      const dir = this.sortDir;
      rooms.sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        switch (col) {
          case 'name':    av = a.name.toLowerCase();         bv = b.name.toLowerCase();         break;
          case 'players': av = a.playerCount;                bv = b.playerCount;                break;
          case 'teams':   av = a.settings.teamMode;          bv = b.settings.teamMode;          break;
          case 'mode':    av = a.settings.winCondition;      bv = b.settings.winCondition;      break;
          case 'access':  av = a.settings.isPublic ? 1 : 0; bv = b.settings.isPublic ? 1 : 0; break;
          case 'time':    av = a.timeRemainingMs;            bv = b.timeRemainingMs;            break;
          default:        return 0;
        }
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === 'asc' ? cmp : -cmp;
      });
    }
    return rooms;
  }

  private _renderFilterBar(y: number, listLeft: number, listW: number): void {
    void listW;
    const btnH = 20;
    let bx = listLeft;

    const pill = (label: string, w: number, active: boolean, onClick: () => void) => {
      const bg = this._push(this.add.rectangle(bx + w / 2, y, w, btnH,
        active ? C.panelHi : 0x0d1f33)
        .setStrokeStyle(1, active ? C.border : C.borderDim)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { onClick(); this.listScrollOffset = 0; this._renderMultiBrowse(); })
        .on('pointerover', () => (bg as Phaser.GameObjects.Rectangle).setFillStyle(active ? C.panelHi : 0x162244))
        .on('pointerout',  () => (bg as Phaser.GameObjects.Rectangle).setFillStyle(active ? C.panelHi : 0x0d1f33))
      );
      this._push(this.add.text(bx + w / 2, y, label, {
        fontSize: '10px', color: active ? C.white : C.textGrey,
      }).setOrigin(0.5));
      bx += w + 2;
    };
    const gap = (n: number) => { bx += n; };

    // Access
    pill('All',     36, this.filterAccess === 'all',     () => { this.filterAccess = 'all'; });
    pill('Public',  44, this.filterAccess === 'public',  () => { this.filterAccess = 'public'; });
    pill('Private', 46, this.filterAccess === 'private', () => { this.filterAccess = 'private'; });
    gap(10);

    // Teams
    pill('FFA',   34, this.filterTeams.has('ffa'),   () => this._toggleFilter(this.filterTeams, 'ffa'));
    pill('2v2',   34, this.filterTeams.has('2team'), () => this._toggleFilter(this.filterTeams, '2team'));
    pill('4-way', 40, this.filterTeams.has('4team'), () => this._toggleFilter(this.filterTeams, '4team'));
    gap(10);

    // Mode
    pill('Timer', 40, this.filterMode.has('timer'),      () => this._toggleFilter(this.filterMode, 'timer'));
    pill('Dom.',  36, this.filterMode.has('domination'),  () => this._toggleFilter(this.filterMode, 'domination'));
    pill('DM',    30, this.filterMode.has('deathmatch'),  () => this._toggleFilter(this.filterMode, 'deathmatch'));
    gap(10);

    // Min players
    pill('1+', 28, this.filterMinSlots === 1, () => { this.filterMinSlots = this.filterMinSlots === 1 ? 0 : 1; });
    pill('2+', 28, this.filterMinSlots === 2, () => { this.filterMinSlots = this.filterMinSlots === 2 ? 0 : 2; });
    pill('4+', 28, this.filterMinSlots === 4, () => { this.filterMinSlots = this.filterMinSlots === 4 ? 0 : 4; });
  }

  private _toggleFilter(set: Set<string>, key: string): void {
    if (set.has(key)) set.delete(key); else set.add(key);
  }

  // ─── Private room code prompt ─────────────────────────────────────────────

  private _renderPrivatePrompt(): void {
    const { cx, H, W } = this;
    // Dim overlay
    this._push(this.add.rectangle(cx, H / 2, W, H, 0x000000).setAlpha(0.72));

    // Box
    const boxW = 300; const boxH = 160; const boxY = H / 2;
    this._push(this.add.rectangle(cx, boxY, boxW, boxH, C.panel).setStrokeStyle(2, C.border));

    const room = this.pendingPrivateRoom!;
    this._push(this.add.text(cx, boxY - 56, '🔒 PRIVATE ROOM', { fontSize: '12px', color: C.textDim, letterSpacing: 2 }).setOrigin(0.5));
    this._push(this.add.text(cx, boxY - 38, this._truncate(room.name, 26), { fontSize: '14px', color: C.text }).setOrigin(0.5));
    this._push(this.add.text(cx, boxY - 16, 'Enter the 6-digit room code:', { fontSize: '12px', color: C.textDim }).setOrigin(0.5));

    // Code input
    this._push(this.add.rectangle(cx, boxY + 8, 172, 30, 0x08121e)
      .setStrokeStyle(1, this.privateCodeFocused ? C.border : 0x2244aa)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.privateCodeFocused = true; this._renderMultiBrowse(); })
    );
    this._push(this.add.text(cx, boxY + 8, this.privateCodeInput || '_ _ _ _ _ _', {
      fontSize: '16px', color: this.privateCodeInput ? C.white : '#334455', fontStyle: 'bold', letterSpacing: 4,
    }).setOrigin(0.5));

    if (this.privateCodeError) {
      this._push(this.add.text(cx, boxY + 30, this.privateCodeError, { fontSize: '11px', color: '#ff6666' }).setOrigin(0.5));
    }

    // Buttons
    const submitBtn = this._push(this.add.rectangle(cx - 40, boxY + 54, 70, 26, C.greenBg)
      .setStrokeStyle(1, C.green).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._submitPrivateCode())
      .on('pointerover', () => (submitBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
      .on('pointerout',  () => (submitBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
    );
    this._push(this.add.text(cx - 40, boxY + 54, 'Join', { fontSize: '13px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));

    const cancelBtn = this._push(this.add.rectangle(cx + 44, boxY + 54, 68, 26, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._closePrivatePrompt())
      .on('pointerover', () => (cancelBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (cancelBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panel))
    );
    this._push(this.add.text(cx + 44, boxY + 54, 'Cancel', { fontSize: '13px', color: C.textGrey }).setOrigin(0.5));
  }

  private _submitPrivateCode(): void {
    const entered = this.privateCodeInput.trim().toUpperCase();
    if (entered.length < 6) {
      this.privateCodeError = 'Please enter all 6 characters.';
      this._renderMultiBrowse();
      return;
    }
    if (entered !== this.pendingPrivateRoom!.code.toUpperCase()) {
      this.privateCodeError = 'Incorrect code. Try again.';
      this.privateCodeInput = '';
      this._renderMultiBrowse();
      return;
    }
    const code = this.pendingPrivateRoom!.code;
    this._closePrivatePrompt();
    this._doJoin(code);
  }

  private _closePrivatePrompt(): void {
    this.pendingPrivateRoom = null;
    this.privateCodeInput   = '';
    this.privateCodeFocused = false;
    this.privateCodeError   = '';
    this._renderMultiBrowse();
  }

  private _joinByCode() {
    const code = this.joinCodeInput.trim().toUpperCase();
    if (code.length < 1) return;
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

    this._push(this.add.text(cx, topY - 10, 'CREATE ROOM', { fontSize: '15px', color: C.textDim, letterSpacing: 3 }).setOrigin(0.5));

    // Room name input
    this._push(this.add.text(cx - 150, topY + 20, 'Room name:', { fontSize: '13px', color: C.textDim }).setOrigin(0, 0.5));
    const nameBox = this._push(this.add.rectangle(cx + 40, topY + 20, 220, 26, 0x08121e)
      .setStrokeStyle(1, this.nameInputFocused ? C.border : 0x2244aa)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.nameInputFocused = true; this._renderCreate(); })
    );
    void nameBox;
    this._push(this.add.text(cx + 40, topY + 20,
      (this.roomNameInput || 'My Room') + (this.nameInputFocused ? '|' : ''),
      { fontSize: '14px', color: this.roomNameInput ? C.white : '#334455' }).setOrigin(0.5));

    let gy = topY + 55;
    const rowH = 30;

    // Map type
    this._push(this.add.text(cx - 150, gy, 'Map:', { fontSize: '13px', color: C.textDim }).setOrigin(0, 0.5));
    const mapProcBtn = this._push(this.add.rectangle(cx + 10, gy, 80, 22,
      this.createSettings.mapType === 'procedural' ? C.panelHi : C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.mapType = 'procedural'; this._renderCreate(); })
    );
    this._push(this.add.text(cx + 10, gy, 'Procedural', { fontSize: '13px', color: C.text }).setOrigin(0.5));
    const mapBmapBtn = this._push(this.add.rectangle(cx + 100, gy, 80, 22,
      this.createSettings.mapType === 'bmap' ? C.panelHi : C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: this.hasMap })
      .on('pointerdown', () => { if (this.hasMap) { this.createSettings.mapType = 'bmap'; this._renderCreate(); } })
    );
    this._push(this.add.text(cx + 100, gy, 'Map file', { fontSize: '13px', color: this.hasMap ? C.text : C.textDim }).setOrigin(0.5));
    void mapProcBtn; void mapBmapBtn;

    if (this.createSettings.mapType === 'bmap') {
      const fname = this.uploadedMapName ?? 'No file chosen';
      gy += rowH;
      this._push(this.add.text(cx - 150, gy, 'Map file:', { fontSize: '15px', color: C.textDim }).setOrigin(0, 0.5));
      const fpBtn = this._push(this.add.rectangle(cx + 30, gy, 160, 22, 0x0a1a0a)
        .setStrokeStyle(1, 0x336633).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this._triggerMapUpload())
      );
      this._push(this.add.text(cx + 30, gy, fname.length > 20 ? fname.slice(0, 18) + '…' : fname, {
        fontSize: '13px', color: fname === 'No file chosen' ? '#334455' : '#88ffaa',
      }).setOrigin(0.5));
      void fpBtn;
    }
    gy += rowH;

    // Team mode
    this._push(this.add.text(cx - 150, gy, 'Teams:', { fontSize: '13px', color: C.textDim }).setOrigin(0, 0.5));
    const teamModes: Array<RoomSettings['teamMode']> = ['ffa', '2team', '4team'];
    let bx = cx - 60;
    for (const tm of teamModes) {
      const active = this.createSettings.teamMode === tm;
      const btn = this._push(this.add.rectangle(bx, gy, 80, 22, active ? C.panelHi : C.panel)
        .setStrokeStyle(1, active ? C.border : C.borderDim).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { this.createSettings.teamMode = tm; this._renderCreate(); })
      );
      this._push(this.add.text(bx, gy, TEAM_MODE_LABELS[tm], { fontSize: '11px', color: active ? C.text : C.textGrey }).setOrigin(0.5));
      void btn;
      bx += 84;
    }
    gy += rowH;

    // Win condition
    this._push(this.add.text(cx - 150, gy, 'Win:', { fontSize: '13px', color: C.textDim }).setOrigin(0, 0.5));
    const winConds: Array<RoomSettings['winCondition']> = ['timer', 'domination', 'deathmatch'];
    bx = cx - 60;
    for (const wc of winConds) {
      const active = this.createSettings.winCondition === wc;
      const btn = this._push(this.add.rectangle(bx, gy, 80, 22, active ? C.panelHi : C.panel)
        .setStrokeStyle(1, active ? C.border : C.borderDim).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { this.createSettings.winCondition = wc; this._renderCreate(); })
      );
      this._push(this.add.text(bx, gy, WIN_COND_LABELS[wc].split(' ')[0], { fontSize: '11px', color: active ? C.text : C.textGrey }).setOrigin(0.5));
      void btn;
      bx += 84;
    }
    gy += rowH;

    // Friendly fire
    this._push(this.add.text(cx - 150, gy, 'Friendly Fire:', { fontSize: '13px', color: C.textDim }).setOrigin(0, 0.5));
    const ffActive = this.createSettings.friendlyFire;
    const ffBtn = this._push(this.add.rectangle(cx + 10, gy, 60, 22, ffActive ? 0x3a1010 : C.panel)
      .setStrokeStyle(1, ffActive ? C.red : C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.friendlyFire = !this.createSettings.friendlyFire; this._renderCreate(); })
    );
    this._push(this.add.text(cx + 10, gy, ffActive ? 'ON' : 'OFF', { fontSize: '13px', color: ffActive ? '#ff6666' : C.textGrey }).setOrigin(0.5));
    void ffBtn;
    gy += rowH;

    // Visibility
    this._push(this.add.text(cx - 150, gy, 'Visibility:', { fontSize: '13px', color: C.textDim }).setOrigin(0, 0.5));
    const pubActive = this.createSettings.isPublic;
    const pubBtn = this._push(this.add.rectangle(cx + 10, gy, 70, 22, pubActive ? C.panelHi : C.panel)
      .setStrokeStyle(1, pubActive ? C.border : C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.isPublic = !this.createSettings.isPublic; this._renderCreate(); })
    );
    this._push(this.add.text(cx + 10, gy, pubActive ? '🔓 Public' : '🔒 Private', { fontSize: '13px', color: C.textGrey }).setOrigin(0.5));
    void pubBtn;
    gy += rowH;

    // Max players
    this._push(this.add.text(cx - 150, gy, 'Max players:', { fontSize: '13px', color: C.textDim }).setOrigin(0, 0.5));
    const decBtn = this._push(this.add.rectangle(cx - 30, gy, 24, 22, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.maxPlayers = Math.max(2, this.createSettings.maxPlayers - 1); this._renderCreate(); })
    );
    this._push(this.add.text(cx - 30, gy, '−', { fontSize: '16px', color: C.text }).setOrigin(0.5));
    this._push(this.add.text(cx + 10, gy, String(this.createSettings.maxPlayers), { fontSize: '15px', color: C.white }).setOrigin(0.5));
    const incBtn = this._push(this.add.rectangle(cx + 50, gy, 24, 22, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.createSettings.maxPlayers = Math.min(16, this.createSettings.maxPlayers + 1); this._renderCreate(); })
    );
    this._push(this.add.text(cx + 50, gy, '+', { fontSize: '16px', color: C.text }).setOrigin(0.5));
    void decBtn; void incBtn;
    gy += rowH;

    // Game length
    this._push(this.add.text(cx - 150, gy, 'Game length:', { fontSize: '15px', color: C.textDim }).setOrigin(0, 0.5));
    const durations = [5 * 60, 10 * 60, 20 * 60, 30 * 60];
    const durLabels = ['5 min', '10 min', '20 min', '30 min'];
    let dx = cx - 110;
    for (let di = 0; di < durations.length; di++) {
      const dur    = durations[di];
      const active = this.createSettings.timerSeconds === dur;
      const dBtn   = this._push(this.add.rectangle(dx, gy, 60, 22, active ? C.panelHi : C.panel)
        .setStrokeStyle(1, active ? C.border : C.borderDim).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { this.createSettings.timerSeconds = dur; this._renderCreate(); })
      );
      this._push(this.add.text(dx, gy, durLabels[di], { fontSize: '13px', color: active ? C.text : C.textGrey }).setOrigin(0.5));
      void dBtn;
      dx += 64;
    }
    gy += rowH + 6;

    // CREATE button
    const createBtn = this._push(this.add.rectangle(cx, gy, 180, 42, C.greenBg)
      .setStrokeStyle(2, C.green).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this._createRoom())
      .on('pointerover', () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenHi))
      .on('pointerout',  () => (createBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.greenBg))
    );
    this._push(this.add.text(cx, gy, '✓  CREATE', { fontSize: '18px', color: '#88ff88', fontStyle: 'bold' }).setOrigin(0.5));

    // Back button
    const backBtn = this._push(this.add.rectangle(cx, gy + 50, 120, 28, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { this.view = 'browse'; this.nameInputFocused = false; this.pendingPrivateRoom = null; this._renderMultiBrowse(); })
      .on('pointerover', () => (backBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (backBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panel))
    );
    this._push(this.add.text(cx, gy + 50, '← Back', { fontSize: '14px', color: C.textGrey }).setOrigin(0.5));
  }

  private _createRoom() {
    const name     = localStorage.getItem(STORAGE_NAME)  ?? 'Player';
    const color    = localStorage.getItem(STORAGE_COLOR) ?? 'ffffff';
    const roomName = this.roomNameInput.trim() || `${name}'s Room`;
    this.createSettings.seed = (Math.random() * 0xFFFFFF) | 0;
    if (this.uploadedMapData && this.createSettings.mapType === 'bmap') {
      this.createSettings.mapData = this.uploadedMapData;
    }
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
      fontSize: '13px', color: C.textDim, letterSpacing: 2,
    }).setOrigin(0.5));

    // Copy link hint
    this._push(this.add.text(cx, topY, `Share: bolo-online.com?room=${code}`, {
      fontSize: '13px', color: '#2a4a6a',
    }).setOrigin(0.5));

    // Player list
    const listY = topY + 22;
    this._push(this.add.text(cx, listY, 'PLAYERS', { fontSize: '13px', color: C.textDim, letterSpacing: 3 }).setOrigin(0.5));

    let py = listY + 18;
    for (const p of players) {
      const isMe   = p.playerId === net.playerId;
      const colVal = parseInt(p.color.replace(/^#/, ''), 16) || 0xffffff;
      const dot    = this._push(this.add.circle(cx - 130, py + 10, 5, colVal));
      void dot;
      this._push(this.add.text(cx - 120, py + 10,
        `${p.name}${isMe ? ' (you)' : ''}${!p.connected ? ' (DC)' : ''}`,
        { fontSize: '14px', color: p.connected ? C.text : C.textDim }).setOrigin(0, 0.5));

      if (isHost && p.playerId !== net.playerId) {
        const kickBtn = this._push(this.add.rectangle(cx + 140, py + 10, 40, 18, 0x2a0808)
          .setStrokeStyle(1, 0x662222).setInteractive({ useHandCursor: true })
          .on('pointerdown', () => { networkManager.kickPlayer(p.playerId); })
          .on('pointerover', () => (kickBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x4a1010))
          .on('pointerout',  () => (kickBtn as Phaser.GameObjects.Rectangle).setFillStyle(0x2a0808))
        );
        this._push(this.add.text(cx + 140, py + 10, 'Kick', { fontSize: '11px', color: '#cc4444' }).setOrigin(0.5));
      }
      py += 22;
    }

    // Settings summary
    if (settings) {
      py = Math.max(py + 8, topY + 140);
      this._push(this.add.text(cx, py, `${TEAM_MODE_LABELS[settings.teamMode] ?? settings.teamMode}  ·  ${WIN_COND_LABELS[settings.winCondition] ?? settings.winCondition}  ·  ${Math.round(settings.timerSeconds / 60)} min`, {
        fontSize: '13px', color: '#334466',
      }).setOrigin(0.5));
      py += 16;
      this._push(this.add.text(cx, py, `Max ${settings.maxPlayers} players  ·  Friendly fire ${settings.friendlyFire ? 'ON' : 'off'}`, {
        fontSize: '13px', color: '#334466',
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
      this._push(this.add.text(cx, py + 20, 'Waiting for host to start…', { fontSize: '15px', color: C.textDim }).setOrigin(0.5));
      py += 40;
    }

    // Leave button
    const leaveBtn = this._push(this.add.rectangle(cx, py + 20, 120, 28, C.panel)
      .setStrokeStyle(1, C.borderDim).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        networkManager.leaveRoom();
        this.view = 'browse';
        this.pendingPrivateRoom = null;
        this._renderMultiBrowse();
        networkManager.listRooms();
      })
      .on('pointerover', () => (leaveBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panelHi))
      .on('pointerout',  () => (leaveBtn as Phaser.GameObjects.Rectangle).setFillStyle(C.panel))
    );
    this._push(this.add.text(cx, py + 20, '← Leave', { fontSize: '14px', color: C.textGrey }).setOrigin(0.5));
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private _truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  private _formatTime(ms: number): string {
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private _cleanupListeners() {
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }
    networkManager.off('roomList',          () => {});
    networkManager.off('roomJoined',        () => {});
    networkManager.off('playerJoined',      () => {});
    networkManager.off('playerRemoved',     () => {});
    networkManager.off('playerGhosted',     () => {});
    networkManager.off('playerReconnected', () => {});
    networkManager.off('settingsUpdated',   () => {});
    networkManager.off('hostChanged',       () => {});
    networkManager.off('error',             () => {});
    networkManager.off('gameStart',         () => {});
  }
}
