import { type Socket, io } from 'socket.io-client';
import type {
  PlayerInfo,
  RoomSettings,
  TankState,
  S2C_RoomList,
  S2C_RoomJoined,
  S2C_PlayerJoined,
  S2C_PlayerLeft,
  S2C_PlayerGhosted,
  S2C_PlayerReconnected,
  S2C_PlayerRemoved,
  S2C_SettingsUpdated,
  S2C_HostChanged,
  S2C_GameStart,
  S2C_StateSnapshot,
  S2C_TankState,
  S2C_BulletFired,
  S2C_BulletHit,
  S2C_TileChanged,
  S2C_PillboxUpdate,
  S2C_BaseUpdate,
  S2C_MineAdded,
  S2C_MineDetonated,
  S2C_BoatAdded,
  S2C_BoatPickedUp,
  S2C_BoatDropped,
  S2C_BoatRemoved,
  S2C_TimeUpdate,
  S2C_PlayerKill,
  S2C_GameOver,
  S2C_PillboxBulletFired,
  S2C_SoldierState,
  S2C_PillboxFire,
  S2C_TankPush,
  S2C_PillPickupSpawned,
  S2C_PillPickupCollected,
} from './types.ts';

// ---------------------------------------------------------------------------
// Event map — maps our friendly event name strings to their payload types
// ---------------------------------------------------------------------------
export type NetEvents = {
  roomList:          S2C_RoomList;
  roomJoined:        S2C_RoomJoined;
  playerJoined:      S2C_PlayerJoined;
  playerLeft:        S2C_PlayerLeft;
  playerGhosted:     S2C_PlayerGhosted;
  playerReconnected: S2C_PlayerReconnected;
  playerRemoved:     S2C_PlayerRemoved;
  settingsUpdated:   S2C_SettingsUpdated;
  hostChanged:       S2C_HostChanged;
  gameStart:         S2C_GameStart;
  stateSnapshot:     S2C_StateSnapshot;
  tankState:         S2C_TankState;
  bulletFired:       S2C_BulletFired;
  bulletHit:         S2C_BulletHit;
  tileChanged:       S2C_TileChanged;
  pillboxUpdate:     S2C_PillboxUpdate;
  baseUpdate:        S2C_BaseUpdate;
  mineAdded:         S2C_MineAdded;
  mineDetonated:     S2C_MineDetonated;
  boatAdded:         S2C_BoatAdded;
  boatPickedUp:      S2C_BoatPickedUp;
  boatDropped:       S2C_BoatDropped;
  boatRemoved:       S2C_BoatRemoved;
  timeUpdate:        S2C_TimeUpdate;
  playerKill:           S2C_PlayerKill;
  gameOver:             S2C_GameOver;
  pillboxBulletFired:   S2C_PillboxBulletFired;
  soldierState:         S2C_SoldierState;
  pillboxFire:          S2C_PillboxFire;
  tankPush:             S2C_TankPush;
  pillPickupSpawned:   S2C_PillPickupSpawned;
  pillPickupCollected: S2C_PillPickupCollected;
  kicked:               void;
  error:                { message: string };
};

// ---------------------------------------------------------------------------
// Internal listener store — typed per event
// ---------------------------------------------------------------------------
type ListenerMap = {
  [K in keyof NetEvents]: Set<(data: NetEvents[K]) => void>;
};

function makeListenerMap(): ListenerMap {
  return {
    roomList:          new Set(),
    roomJoined:        new Set(),
    playerJoined:      new Set(),
    playerLeft:        new Set(),
    playerGhosted:     new Set(),
    playerReconnected: new Set(),
    playerRemoved:     new Set(),
    settingsUpdated:   new Set(),
    hostChanged:       new Set(),
    gameStart:         new Set(),
    stateSnapshot:     new Set(),
    tankState:         new Set(),
    bulletFired:       new Set(),
    bulletHit:         new Set(),
    tileChanged:       new Set(),
    pillboxUpdate:     new Set(),
    baseUpdate:        new Set(),
    mineAdded:         new Set(),
    mineDetonated:     new Set(),
    boatAdded:         new Set(),
    boatPickedUp:      new Set(),
    boatDropped:       new Set(),
    boatRemoved:       new Set(),
    timeUpdate:        new Set(),
    playerKill:          new Set(),
    gameOver:            new Set(),
    pillboxBulletFired:  new Set(),
    soldierState:        new Set(),
    pillboxFire:         new Set(),
    tankPush:            new Set(),
    pillPickupSpawned:   new Set(),
    pillPickupCollected: new Set(),
    kicked:              new Set(),
    error:               new Set(),
  };
}

// ---------------------------------------------------------------------------
// The server emits the same string keys we use internally, so we just
// forward them.  Build a typed list so we can iterate cleanly.
// ---------------------------------------------------------------------------
const SERVER_EVENTS: (keyof NetEvents)[] = [
  'roomList', 'roomJoined', 'playerJoined', 'playerLeft', 'playerGhosted',
  'playerReconnected', 'playerRemoved', 'settingsUpdated', 'hostChanged',
  'gameStart', 'stateSnapshot', 'tankState', 'bulletFired', 'bulletHit',
  'tileChanged', 'pillboxUpdate', 'baseUpdate', 'mineAdded', 'mineDetonated',
  'boatAdded', 'boatPickedUp', 'boatDropped', 'boatRemoved',
  'timeUpdate', 'playerKill', 'gameOver', 'pillboxBulletFired',
  'soldierState', 'pillboxFire', 'tankPush',
  'pillPickupSpawned', 'pillPickupCollected',
  'kicked', 'error',
];

const SERVER_URL = import.meta.env.PROD
  ? 'https://api.bolo-online.com'
  : 'http://localhost:3000';

const STORAGE_KEY = 'bolo_playerId';

// ---------------------------------------------------------------------------
// NetworkManager singleton
// ---------------------------------------------------------------------------
export class NetworkManager {
  private static _instance: NetworkManager | null = null;

  static get instance(): NetworkManager {
    if (!NetworkManager._instance) {
      NetworkManager._instance = new NetworkManager();
    }
    return NetworkManager._instance;
  }

  private constructor() {
    this._listeners = makeListenerMap();
  }

  // ── public state ──────────────────────────────────────────────────────────
  playerId    = '';
  roomId      = '';
  roomCode    = '';
  isHost      = false;
  players     = new Map<string, PlayerInfo>();
  myTeamIndex = 0;
  settings: RoomSettings | null = null;
  latency     = 0;

  // ── private ───────────────────────────────────────────────────────────────
  private socket: Socket | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _listeners: ListenerMap;

  // ── connection ────────────────────────────────────────────────────────────

  connect(): void {
    if (this.socket?.connected) return;

    if (this.socket) {
      // Reuse existing socket object — socket.io will reconnect automatically
      this.socket.connect();
      return;
    }

    this.socket = io(SERVER_URL, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this._attachSocketListeners();
    this._startPing();
  }

  disconnect(): void {
    this._stopPing();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // ── lobby ─────────────────────────────────────────────────────────────────

  listRooms(): void {
    this.socket?.emit('listRooms');
  }

  createRoom(roomName: string, settings: RoomSettings, name: string, color: string): void {
    this.socket?.emit('createRoom', { roomName, settings, name, color });
  }

  joinRoom(code: string, name: string, color: string): void {
    this.socket?.emit('joinRoom', { code, name, color });
  }

  rejoinRoom(code: string, name: string, color: string): void {
    const storedId = localStorage.getItem(STORAGE_KEY) ?? '';
    this.socket?.emit('rejoinRoom', { code, playerId: storedId, name, color });
  }

  leaveRoom(): void {
    this.socket?.emit('leaveRoom');
    this._resetRoomState();
  }

  updateSettings(settings: Partial<RoomSettings>): void {
    this.socket?.emit('updateSettings', { settings });
  }

  kickPlayer(playerId: string): void {
    this.socket?.emit('kickPlayer', { playerId });
  }

  startGame(): void {
    this.socket?.emit('startGame');
  }

  // ── in-game ───────────────────────────────────────────────────────────────

  sendTankState(state: Omit<TankState, 'playerId'>): void {
    this.socket?.volatile.emit('tankState', { ...state, playerId: this.playerId });
  }

  sendBulletFired(x: number, y: number, angleDeg: number): void {
    this.socket?.emit('bulletFired', { x, y, angleDeg, timestamp: Date.now() });
  }

  sendBulletHit(targetId: string, damage: number): void {
    this.socket?.emit('bulletHit', { targetId, damage, shooterId: this.playerId });
  }

  sendPlayerKill(victimId: string): void {
    this.socket?.emit('playerKill', { victimId });
  }

  /** Called by the VICTIM when they die — reports the killer. */
  sendPlayerKillSelf(killerId: string): void {
    this.socket?.emit('playerKill', { victimId: this.playerId, killerId });
  }

  sendTileChanged(tileX: number, tileY: number, displayTile: number): void {
    this.socket?.emit('tileChanged', { tileX, tileY, displayTile });
  }

  sendPillboxUpdate(index: number, ownerId: string | null, health: number, alive: boolean): void {
    this.socket?.emit('pillboxUpdate', { index, ownerId, health, alive });
  }

  sendBaseUpdate(index: number, ownerId: string | null, health: number, shells: number, mines: number): void {
    this.socket?.emit('baseUpdate', { index, ownerId, health, shells, mines });
  }

  sendMineAdded(tileX: number, tileY: number): void {
    this.socket?.emit('mineAdded', { tileX, tileY, ownerPlayerId: this.playerId });
  }

  sendMineDetonated(tileX: number, tileY: number): void {
    this.socket?.emit('mineDetonated', { tileX, tileY });
  }

  sendBoatAdded(tileX: number, tileY: number): void {
    this.socket?.emit('boatAdded', { tileX, tileY });
  }

  sendBoatPickedUp(tileX: number, tileY: number): void {
    this.socket?.emit('boatPickedUp', { tileX, tileY });
  }

  sendBoatDropped(tileX: number, tileY: number): void {
    this.socket?.emit('boatDropped', { tileX, tileY });
  }

  sendRequestSnapshot(): void {
    this.socket?.emit('requestSnapshot');
  }

  sendPillboxBulletFired(pillIndex: number, x: number, y: number, angleDeg: number): void {
    this.socket?.emit('pillboxBulletFired', { pillIndex, x, y, angleDeg });
  }

  sendSoldierState(x: number, y: number, active: boolean): void {
    this.socket?.volatile.emit('soldierState', { x, y, active });
  }

  sendPillboxFire(pillIndex: number, angleDeg: number): void {
    this.socket?.emit('pillboxFire', { pillIndex, angleDeg });
  }

  sendTankPush(targetId: string, impulseX: number, impulseY: number): void {
    this.socket?.volatile.emit('tankPush', { targetId, impulseX, impulseY });
  }

  sendPillPickupSpawned(id: string, x: number, y: number): void {
    this.socket?.emit('pillPickupSpawned', { id, x, y });
  }

  sendPillPickupCollected(id: string): void {
    this.socket?.emit('pillPickupCollected', { id });
  }

  returnToLobby(): void {
    this.socket?.emit('leaveRoom');
    this._resetRoomState();
  }

  // ── event registration ────────────────────────────────────────────────────

  on<K extends keyof NetEvents>(event: K, cb: (data: NetEvents[K]) => void): void {
    (this._listeners[event] as Set<(data: NetEvents[K]) => void>).add(cb);
  }

  off<K extends keyof NetEvents>(event: K, cb: (data: NetEvents[K]) => void): void {
    (this._listeners[event] as Set<(data: NetEvents[K]) => void>).delete(cb);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  isMyTeam(playerId: string): boolean {
    if (!this.settings || this.settings.teamMode === 'ffa') {
      return playerId === this.playerId;
    }
    const other = this.players.get(playerId);
    if (!other) return false;
    return other.teamIndex === this.myTeamIndex;
  }

  getPlayerColor(playerId: string): number {
    const player = this.players.get(playerId);
    if (!player) return 0xffffff;
    const hex = player.color.replace(/^#/, '');
    return parseInt(hex, 16);
  }

  // ── private helpers ───────────────────────────────────────────────────────

  private _attachSocketListeners(): void {
    if (!this.socket) return;

    // Intercept roomJoined to update local state before forwarding
    this.socket.on('roomJoined', (data: NetEvents['roomJoined']) => {
      this.playerId    = data.playerId;
      this.roomId      = data.roomId;
      this.roomCode    = data.code;
      this.isHost      = data.isHost;
      this.settings    = data.settings;
      this.players.clear();
      for (const p of data.players) {
        this.players.set(p.playerId, p);
      }
      const me = this.players.get(this.playerId);
      this.myTeamIndex = me?.teamIndex ?? 0;

      // Persist playerId for reconnect
      localStorage.setItem(STORAGE_KEY, this.playerId);

      this._emit('roomJoined', data);
    });

    // Keep players map in sync
    this.socket.on('playerJoined', (data: NetEvents['playerJoined']) => {
      this.players.set(data.player.playerId, data.player);
      this._emit('playerJoined', data);
    });

    this.socket.on('playerLeft', (data: NetEvents['playerLeft']) => {
      this.players.delete(data.playerId);
      this._emit('playerLeft', data);
    });

    this.socket.on('playerGhosted', (data: NetEvents['playerGhosted']) => {
      const p = this.players.get(data.playerId);
      if (p) p.connected = false;
      this._emit('playerGhosted', data);
    });

    this.socket.on('playerReconnected', (data: NetEvents['playerReconnected']) => {
      this.players.set(data.playerId, data.player);
      this._emit('playerReconnected', data);
    });

    this.socket.on('playerRemoved', (data: NetEvents['playerRemoved']) => {
      this.players.delete(data.playerId);
      this._emit('playerRemoved', data);
    });

    this.socket.on('settingsUpdated', (data: NetEvents['settingsUpdated']) => {
      this.settings = data.settings;
      this._emit('settingsUpdated', data);
    });

    this.socket.on('hostChanged', (data: NetEvents['hostChanged']) => {
      this.isHost = data.newHostPlayerId === this.playerId;
      this._emit('hostChanged', data);
    });

    // Forward all remaining events generically
    const skipSet = new Set([
      'roomJoined', 'playerJoined', 'playerLeft', 'playerGhosted',
      'playerReconnected', 'playerRemoved', 'settingsUpdated', 'hostChanged',
    ]);

    for (const event of SERVER_EVENTS) {
      if (skipSet.has(event)) continue;
      this.socket.on(event, (data: NetEvents[typeof event]) => {
        this._emit(event, data);
      });
    }
  }

  private _emit<K extends keyof NetEvents>(event: K, data: NetEvents[K]): void {
    const listeners = this._listeners[event] as Set<(data: NetEvents[K]) => void>;
    for (const cb of listeners) {
      try {
        cb(data);
      } catch (err) {
        console.error(`[NetworkManager] Error in listener for "${event}":`, err);
      }
    }
  }

  private _startPing(): void {
    if (this.pingInterval !== null) return;
    this.pingInterval = setInterval(() => {
      if (!this.socket?.connected) return;
      const start = Date.now();
      this.socket.emit('ping', () => {
        this.latency = Date.now() - start;
      });
    }, 2000);
  }

  private _stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private _resetRoomState(): void {
    this.playerId    = '';
    this.roomId      = '';
    this.roomCode    = '';
    this.isHost      = false;
    this.myTeamIndex = 0;
    this.settings    = null;
    this.players.clear();
  }
}

export const networkManager = NetworkManager.instance;
