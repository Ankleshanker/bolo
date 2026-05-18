import type { Server } from 'socket.io';
import type {
  RoomSettings, RoomState, PlayerInfo, RoomSummary,
  TankState, TileDiff, PillboxState, BaseState, MineState, BoatState, PillPickupState,
  S2C_GameStart, S2C_GameOver, S2C_StateSnapshot, S2C_TimeUpdate, S2C_PlayerKill,
} from './types.js';

export class GameRoom {
  readonly roomId:   string;
  readonly code:     string;
  readonly roomName: string;

  state:        RoomState = 'LOBBY';
  settings:     RoomSettings;
  hostPlayerId: string;

  /** playerId → PlayerInfo */
  players = new Map<string, PlayerInfo>();
  /** socketId → playerId */
  socketToPlayer = new Map<string, string>();
  /** playerId → socketId */
  playerToSocket = new Map<string, string>();
  /** playerId → TankState */
  tankStates = new Map<string, TankState>();

  snapshot = {
    terrainDiffs:  [] as TileDiff[],
    pillboxStates: [] as PillboxState[],
    baseStates:    [] as BaseState[],
    mines:         [] as MineState[],
    boats:         [] as BoatState[],
    pillPickups:   [] as PillPickupState[],
  };

  timerMs         = 0;
  serverStartTime = 0;

  private tickInterval:     ReturnType<typeof setInterval>  | null = null;
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Invoked (by index.ts) when a player's 60 s grace period expires. */
  onPlayerExpired: (playerId: string) => void = () => {};

  constructor(
    roomId: string, code: string, roomName: string,
    hostPlayerId: string, hostSocketId: string,
    hostName: string, hostColor: string,
    settings: RoomSettings,
  ) {
    this.roomId      = roomId;
    this.code        = code;
    this.roomName    = roomName;
    this.hostPlayerId = hostPlayerId;
    this.settings    = settings;

    const host = this._makePlayer(hostPlayerId, hostName, hostColor, 0);
    this.players.set(hostPlayerId, host);
    this.socketToPlayer.set(hostSocketId, hostPlayerId);
    this.playerToSocket.set(hostPlayerId, hostSocketId);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private _makePlayer(id: string, name: string, color: string, team: number): PlayerInfo {
    return { playerId: id, name, color, teamIndex: team, connected: true, kills: 0, deaths: 0 };
  }

  private _nextTeamIndex(): number {
    const n = this.players.size;
    if (this.settings.teamMode === 'ffa')    return n;
    if (this.settings.teamMode === '2team')  return n % 2;
    return n % 4;
  }

  // ─── Player management ────────────────────────────────────────────────────

  addPlayer(socketId: string, playerId: string, name: string, color: string): PlayerInfo {
    const info = this._makePlayer(playerId, name, color, this._nextTeamIndex());
    this.players.set(playerId, info);
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);
    return info;
  }

  /** Start 60 s grace timer; onPlayerExpired fires if not reconnected. */
  removePlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected       = false;
    p.disconnectedAt  = Date.now();

    const existing = this.disconnectTimers.get(playerId);
    if (existing) clearTimeout(existing);

    this.disconnectTimers.set(playerId, setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      this.onPlayerExpired(playerId);
    }, 60_000));
  }

  /** Hard-remove a player (grace expired or explicit kick). Returns new host id or null. */
  expirePlayer(playerId: string): string | null {
    const t = this.disconnectTimers.get(playerId);
    if (t) { clearTimeout(t); this.disconnectTimers.delete(playerId); }

    const socketId = this.playerToSocket.get(playerId);
    if (socketId) this.socketToPlayer.delete(socketId);
    this.playerToSocket.delete(playerId);
    this.players.delete(playerId);
    this.tankStates.delete(playerId);

    // Neutralise owned objects
    for (const pill of this.snapshot.pillboxStates) {
      if (pill.ownerId === playerId) pill.ownerId = null;
    }
    for (const base of this.snapshot.baseStates) {
      if (base.ownerId === playerId) base.ownerId = null;
    }

    // Migrate host
    if (this.hostPlayerId === playerId) {
      const next = [...this.players.values()].find(p => p.connected);
      if (next) { this.hostPlayerId = next.playerId; return next.playerId; }
    }
    return null;
  }

  reconnectPlayer(socketId: string, playerId: string, name: string, color: string): PlayerInfo | null {
    const p = this.players.get(playerId);
    if (!p) return null;

    const t = this.disconnectTimers.get(playerId);
    if (t) { clearTimeout(t); this.disconnectTimers.delete(playerId); }

    const oldSocket = this.playerToSocket.get(playerId);
    if (oldSocket) this.socketToPlayer.delete(oldSocket);
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);

    p.connected = true;
    delete p.disconnectedAt;
    p.name  = name;
    p.color = color;
    return p;
  }

  // ─── Game lifecycle ───────────────────────────────────────────────────────

  startGame(io: Server, roomId: string): void {
    if (this.state !== 'LOBBY') return;
    this.state          = 'PLAYING';
    this.timerMs        = this.settings.timerSeconds * 1_000;
    this.serverStartTime = Date.now();

    // Finalise team assignments
    const list = [...this.players.values()];
    list.forEach((p, i) => {
      p.teamIndex = this.settings.teamMode === 'ffa'   ? i
                  : this.settings.teamMode === '2team' ? i % 2
                  : i % 4;
    });

    const payload: S2C_GameStart = {
      mapType:         this.settings.mapType,
      mapName:         this.settings.mapName,
      seed:            this.settings.seed,
      teamAssignments: list.map(p => ({ playerId: p.playerId, teamIndex: p.teamIndex })),
      players:         list,
      settings:        this.settings,
      serverStartTime: this.serverStartTime,
    };
    io.to(roomId).emit('gameStart', payload);

    this.tickInterval = setInterval(() => this.tick(io, roomId), 1_000);
  }

  tick(io: Server, roomId: string): void {
    if (this.state !== 'PLAYING') return;

    this.timerMs = Math.max(0, this.timerMs - 1_000);
    const tu: S2C_TimeUpdate = { remaining: this.timerMs };
    io.to(roomId).emit('timeUpdate', tu);

    const over = this.checkWinCondition();
    if (over) this._endGame(io, roomId, over);
  }

  private _endGame(io: Server, roomId: string, payload: S2C_GameOver): void {
    this.state = 'ENDED';
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
    io.to(roomId).emit('gameOver', payload);
  }

  /** Immediately end the game and broadcast a pre-built payload (e.g. triggered by kill event). */
  endGame(io: Server, roomId: string, payload: S2C_GameOver): void {
    if (this.state === 'ENDED') return;
    this._endGame(io, roomId, payload);
  }

  checkWinCondition(): S2C_GameOver | null {
    const wc = this.settings.winCondition;

    if (wc === 'domination') {
      const owners = [
        ...this.snapshot.pillboxStates.filter(p => p.alive).map(p => p.ownerId),
        ...this.snapshot.baseStates.map(b => b.ownerId),
      ];
      if (owners.length > 0 && owners.every(o => o !== null && o === owners[0])) {
        return this._buildGameOver('domination', owners[0]!);
      }
    }

    if (wc === 'deathmatch') {
      // Last-player-standing check
      const alive = [...this.players.values()].filter(p => {
        const ts = this.tankStates.get(p.playerId);
        return ts ? ts.alive : true; // default alive if no state yet
      });
      if (alive.length === 1 && this.players.size > 1) {
        return this._buildGameOver('lastPlayer', alive[0].playerId);
      }
    }

    if (this.timerMs <= 0) {
      const reason = wc === 'deathmatch' ? 'deathmatch' : 'timer';
      const winner = wc === 'deathmatch' ? this._killsWinner() : this._objectivesWinner();
      return this._buildGameOver(reason, winner);
    }

    return null;
  }

  private _objectivesWinner(): string | null {
    const score = new Map<string, number>();
    for (const p of this.snapshot.pillboxStates) {
      if (p.alive && p.ownerId) score.set(p.ownerId, (score.get(p.ownerId) ?? 0) + 1);
    }
    for (const b of this.snapshot.baseStates) {
      if (b.ownerId) score.set(b.ownerId, (score.get(b.ownerId) ?? 0) + 1);
    }
    let best: string | null = null; let bestN = -1;
    for (const [id, n] of score) { if (n > bestN) { best = id; bestN = n; } }
    return best;
  }

  private _killsWinner(): string | null {
    let best: PlayerInfo | null = null;
    for (const p of this.players.values()) {
      if (!best || p.kills > best.kills) best = p;
    }
    return best?.playerId ?? null;
  }

  private _buildGameOver(reason: S2C_GameOver['reason'], winnerId: string | null): S2C_GameOver {
    const winner = winnerId ? this.players.get(winnerId) : null;
    const scores = [...this.players.values()].map(p => ({
      playerId:   p.playerId,
      name:       p.name,
      teamIndex:  p.teamIndex,
      kills:      p.kills,
      deaths:     p.deaths,
      objectives:
        this.snapshot.pillboxStates.filter(pb => pb.alive && pb.ownerId === p.playerId).length +
        this.snapshot.baseStates.filter(b => b.ownerId === p.playerId).length,
    }));
    return { reason, winnerId, winnerName: winner?.name ?? '', scores };
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  getSnapshot(): S2C_StateSnapshot {
    return {
      ...this.snapshot,
      tankStates:  [...this.tankStates.values()],
      timeElapsed: this.state === 'PLAYING'
        ? Date.now() - this.serverStartTime
        : 0,
    };
  }

  getSummary(): RoomSummary {
    const host = this.players.get(this.hostPlayerId);
    const connected = [...this.players.values()].filter(p => p.connected);
    return {
      roomId:          this.roomId,
      code:            this.code,
      name:            this.roomName,
      hostName:        host?.name ?? '',
      playerCount:     connected.length,
      maxPlayers:      this.settings.maxPlayers,
      state:           this.state,
      settings:        this.settings,
      timeRemainingMs: this.state === 'PLAYING' ? Math.max(0, this.timerMs)
                     : this.state === 'LOBBY'   ? this.settings.timerSeconds * 1000
                     : 0,
    };
  }

  // ─── World mutations ──────────────────────────────────────────────────────

  updateTileChanged(diff: TileDiff): void {
    const i = this.snapshot.terrainDiffs.findIndex(d => d.tileX === diff.tileX && d.tileY === diff.tileY);
    if (i >= 0) this.snapshot.terrainDiffs[i] = diff;
    else         this.snapshot.terrainDiffs.push(diff);
    // A tile change means a boat at this position (if any) is gone.
    this.removeBoatAt(diff.tileX, diff.tileY);
  }

  removeBoatAt(tileX: number, tileY: number): void {
    this.snapshot.boats = this.snapshot.boats.filter(b => !(b.tileX === tileX && b.tileY === tileY));
  }

  addPillPickup(state: PillPickupState): void {
    this.snapshot.pillPickups.push(state);
  }

  removePillPickup(id: string): boolean {
    const i = this.snapshot.pillPickups.findIndex(p => p.id === id);
    if (i < 0) return false;
    this.snapshot.pillPickups.splice(i, 1);
    return true;
  }

  updatePillbox(state: PillboxState): void {
    const i = this.snapshot.pillboxStates.findIndex(p => p.index === state.index);
    if (i >= 0) this.snapshot.pillboxStates[i] = state;
    else         this.snapshot.pillboxStates.push(state);
  }

  updateBase(state: BaseState): void {
    const i = this.snapshot.baseStates.findIndex(b => b.index === state.index);
    if (i >= 0) this.snapshot.baseStates[i] = state;
    else         this.snapshot.baseStates.push(state);
  }

  addMine(mine: MineState): void {
    this.snapshot.mines.push(mine);
  }

  removeMine(tileX: number, tileY: number): void {
    this.snapshot.mines = this.snapshot.mines.filter(m => !(m.tileX === tileX && m.tileY === tileY));
  }

  addBoat(boat: BoatState): void {
    if (!this.snapshot.boats.find(b => b.tileX === boat.tileX && b.tileY === boat.tileY)) {
      this.snapshot.boats.push(boat);
    }
  }

  updateTankState(state: TankState): void {
    this.tankStates.set(state.playerId, state);
  }

  recordKill(killerId: string, victimId: string): S2C_PlayerKill | null {
    const killer = this.players.get(killerId);
    const victim = this.players.get(victimId);
    if (!killer || !victim) return null;
    killer.kills++;
    victim.deaths++;
    const ts = this.tankStates.get(victimId);
    if (ts) { ts.alive = false; }
    return { killerId, killerName: killer.name, victimId, victimName: victim.name };
  }
}
