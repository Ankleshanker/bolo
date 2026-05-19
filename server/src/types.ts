// ─── Shared types for client ↔ server communication ──────────────────────────
// Imported by server code directly; client imports a copy at src/network/types.ts
// (identical file, kept in sync manually or via a build step).

export type TeamMode     = 'ffa' | '2team' | '4team';
export type WinCondition = 'timer' | 'domination' | 'deathmatch';
export type RoomState    = 'LOBBY' | 'PLAYING' | 'ENDED';

// ─── Room ─────────────────────────────────────────────────────────────────────

export interface RoomSettings {
  mapType:      'procedural' | 'bmap';
  mapName:      string;          // ignored when mapType='procedural'
  seed:         number;
  teamMode:     TeamMode;
  winCondition: WinCondition;
  friendlyFire: boolean;
  maxPlayers:   number;          // 2–16
  isPublic:     boolean;
  timerSeconds: number;          // default 300
  mapData?:     string;          // base64-encoded .bmap binary (optional, for inline map upload)
}

export interface PlayerInfo {
  playerId:        string;       // stable UUID assigned on first join
  name:            string;
  color:           string;       // hex string e.g. 'ff4444'
  teamIndex:       number;       // 0-based; in FFA each player is their own team
  connected:       boolean;
  disconnectedAt?: number;       // ms timestamp, set when disconnected
  kills:           number;
  deaths:          number;
}

export interface RoomSummary {
  roomId:          string;
  code:            string;           // 6-char uppercase alphanumeric
  name:            string;
  hostName:        string;
  playerCount:     number;
  maxPlayers:      number;
  state:           RoomState;
  settings:        RoomSettings;
  timeRemainingMs: number;           // ms left on the game clock; full timer if LOBBY, 0 if ENDED
}

// ─── World state ──────────────────────────────────────────────────────────────

export interface TileDiff {
  tileX:       number;
  tileY:       number;
  displayTile: number;
}

export interface PillboxState {
  index:    number;
  ownerId:  string | null;       // null = neutral
  health:   number;              // 0–4
  alive:    boolean;
}

export interface BaseState {
  index:   number;
  ownerId: string | null;        // null = neutral
  health:  number;               // 0 = neutral/destroyed, BASE_MAX_HEALTH when owned
  shells:  number;               // 0–90 current ammo supply
  mines:   number;               // 0–20 current mine supply
}

export interface MineState {
  tileX:         number;
  tileY:         number;
  ownerPlayerId: string;
}

export interface BoatState {
  tileX: number;
  tileY: number;
}

export interface PillPickupState {
  id: string;
  x:  number;
  y:  number;
}

export interface WorldSnapshot {
  terrainDiffs:  TileDiff[];
  pillboxStates: PillboxState[];
  baseStates:    BaseState[];
  mines:         MineState[];
  boats:         BoatState[];
  pillPickups:   PillPickupState[];
}

// ─── Tank state (sent 20 Hz client → server → all other clients) ──────────────

export interface TankState {
  playerId:  string;
  x:         number;
  y:         number;
  angle:     number;
  alive:     boolean;
  inForest:  boolean;
  inBoat:    boolean;
  health:    number;
  shells:    number;
  mines:     number;
  trees:     number;
}

// ─── Client → Server events ───────────────────────────────────────────────────

export interface C2S_CreateRoom {
  roomName: string;
  settings: RoomSettings;
  name:     string;
  color:    string;
}

export interface C2S_JoinRoom {
  code:  string;
  name:  string;
  color: string;
}

export interface C2S_RejoinRoom {
  code:     string;
  playerId: string;
  name:     string;
  color:    string;
}

export interface C2S_UpdateSettings {
  settings: Partial<RoomSettings>;
}

export interface C2S_KickPlayer {
  playerId: string;
}

export interface C2S_TileChanged {
  tileX:       number;
  tileY:       number;
  displayTile: number;
}

export interface C2S_PillboxUpdate {
  index:   number;
  ownerId: string | null;
  health:  number;
  alive:   boolean;
}

export interface C2S_BaseUpdate extends BaseState {}

export interface C2S_MineAdded {
  tileX: number;
  tileY: number;
}

export interface C2S_MineDetonated {
  tileX: number;
  tileY: number;
}

export interface C2S_BoatAdded {
  tileX: number;
  tileY: number;
}

export interface C2S_BulletFired {
  x:         number;
  y:         number;
  angleDeg:  number;
  timestamp: number;
}

export interface C2S_BulletHit {
  targetId:  string;
  damage:    number;
  shooterId: string;
}

export interface C2S_PlayerKill {
  victimId:  string;
  killerId?: string; // set when the VICTIM reports their own death (killerId = who killed them)
}

// ─── Server → Client events ───────────────────────────────────────────────────

export interface S2C_Welcome {
  socketId: string;
}

export interface S2C_RoomList {
  rooms: RoomSummary[];
}

export interface S2C_RoomJoined {
  roomId:   string;
  code:     string;
  playerId: string;
  players:  PlayerInfo[];
  settings: RoomSettings;
  isHost:   boolean;
  state:    RoomState;
}

export interface S2C_PlayerJoined {
  player: PlayerInfo;
}

export interface S2C_PlayerLeft {
  playerId: string;
}

export interface S2C_PlayerGhosted {
  playerId: string;
}

export interface S2C_PlayerReconnected {
  playerId: string;
  player:   PlayerInfo;
}

export interface S2C_PlayerRemoved {
  playerId: string;
}

export interface S2C_SettingsUpdated {
  settings: RoomSettings;
}

export interface S2C_HostChanged {
  newHostPlayerId: string;
}

export interface S2C_GameStart {
  mapType:         'procedural' | 'bmap';
  mapName:         string;
  seed:            number;
  teamAssignments: { playerId: string; teamIndex: number }[];
  players:         PlayerInfo[];
  settings:        RoomSettings;
  serverStartTime: number;       // server ms timestamp at game start
}

export interface S2C_StateSnapshot extends WorldSnapshot {
  tankStates:  TankState[];
  timeElapsed: number;           // ms since game started
}

export interface S2C_TankState extends TankState {}

export interface S2C_BulletFired {
  shooterId: string;
  x:         number;
  y:         number;
  angleDeg:  number;
}

export interface S2C_BulletHit {
  targetId:  string;
  damage:    number;
  shooterId: string;
}

export interface S2C_TileChanged extends TileDiff {
  playerId: string;
}

export interface S2C_PillboxUpdate extends PillboxState {}

export interface S2C_BaseUpdate extends BaseState {}

export interface S2C_MineAdded extends MineState {}

export interface S2C_MineDetonated {
  tileX:       number;
  tileY:       number;
  damage:      number;
  triggeredBy: string;
}

export interface S2C_BoatAdded extends BoatState {}

export interface S2C_TimeUpdate {
  remaining: number;             // ms
}

export interface S2C_PlayerKill {
  killerId:   string;
  killerName: string;
  victimId:   string;
  victimName: string;
}

export interface S2C_GameOver {
  reason:     'timer' | 'domination' | 'deathmatch' | 'lastPlayer';
  winnerId:   string | null;     // playerId, teamIndex as string, or null
  winnerName: string;
  scores: {
    playerId:   string;
    name:       string;
    teamIndex:  number;
    kills:      number;
    deaths:     number;
    objectives: number;          // pills + bases owned at game end
  }[];
}

export interface C2S_SoldierState { x: number; y: number; active: boolean; }
export interface S2C_SoldierState { playerId: string; x: number; y: number; active: boolean; }
export interface S2C_PillboxFire  { pillIndex: number; angleDeg: number; }

export interface S2C_Error {
  message: string;
}

export interface C2S_PillboxBulletFired {
  pillIndex: number;
  x:         number;
  y:         number;
  angleDeg:  number;
}

export interface S2C_PillboxBulletFired {
  pillIndex: number;
  x:         number;
  y:         number;
  angleDeg:  number;
}

export interface C2S_TankPush { targetId: string; impulseX: number; impulseY: number; }
export interface S2C_TankPush { impulseX: number; impulseY: number; }

export interface C2S_PillPickupSpawned  { id: string; x: number; y: number; }
export interface S2C_PillPickupSpawned  { id: string; x: number; y: number; }
export interface C2S_PillPickupCollected { id: string; }
export interface S2C_PillPickupCollected { id: string; collectorId: string; }
export interface C2S_BoatPickedUp { tileX: number; tileY: number; }
export interface S2C_BoatPickedUp { tileX: number; tileY: number; }
export interface C2S_BoatDropped  { tileX: number; tileY: number; }
export interface S2C_BoatDropped  { tileX: number; tileY: number; }
export interface S2C_BoatRemoved  { tileX: number; tileY: number; }
