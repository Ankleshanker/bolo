export type TeamMode     = 'ffa' | '2team' | '4team';
export type WinCondition = 'timer' | 'domination' | 'deathmatch';
export type RoomState    = 'LOBBY' | 'PLAYING' | 'ENDED';
export interface RoomSettings { mapType: 'procedural'|'bmap'; mapName: string; seed: number; teamMode: TeamMode; winCondition: WinCondition; friendlyFire: boolean; maxPlayers: number; isPublic: boolean; timerSeconds: number; mapData?: string; }
export interface PlayerInfo { playerId: string; name: string; color: string; teamIndex: number; connected: boolean; disconnectedAt?: number; kills: number; deaths: number; }
export interface RoomSummary { roomId: string; code: string; name: string; hostName: string; playerCount: number; maxPlayers: number; state: RoomState; settings: RoomSettings; timeRemainingMs: number; }
export interface TileDiff { tileX: number; tileY: number; displayTile: number; }
export interface PillboxState { index: number; ownerId: string|null; health: number; alive: boolean; }
export interface BaseState { index: number; ownerId: string|null; health: number; shells: number; mines: number; }
export interface MineState { tileX: number; tileY: number; ownerPlayerId: string; }
export interface BoatState { tileX: number; tileY: number; }
export interface PillPickupState { id: string; x: number; y: number; }
export interface WorldSnapshot { terrainDiffs: TileDiff[]; pillboxStates: PillboxState[]; baseStates: BaseState[]; mines: MineState[]; boats: BoatState[]; pillPickups: PillPickupState[]; }
export interface TankState { playerId: string; x: number; y: number; angle: number; alive: boolean; inForest: boolean; inBoat: boolean; health: number; shells: number; mines: number; trees: number; }
export interface C2S_CreateRoom { roomName: string; settings: RoomSettings; name: string; color: string; }
export interface C2S_JoinRoom { code: string; name: string; color: string; }
export interface C2S_RejoinRoom { code: string; playerId: string; name: string; color: string; }
export interface C2S_UpdateSettings { settings: Partial<RoomSettings>; }
export interface C2S_BulletFired { x: number; y: number; angleDeg: number; timestamp: number; }
export interface C2S_BulletHit { targetId: string; damage: number; shooterId: string; }
export interface C2S_PlayerKill { victimId: string; killerId?: string; }
export interface S2C_RoomList { rooms: RoomSummary[]; }
export interface S2C_RoomJoined { roomId: string; code: string; playerId: string; players: PlayerInfo[]; settings: RoomSettings; isHost: boolean; state: RoomState; }
export interface S2C_PlayerJoined { player: PlayerInfo; }
export interface S2C_PlayerLeft { playerId: string; }
export interface S2C_PlayerGhosted { playerId: string; }
export interface S2C_PlayerReconnected { playerId: string; player: PlayerInfo; }
export interface S2C_PlayerRemoved { playerId: string; }
export interface S2C_SettingsUpdated { settings: RoomSettings; }
export interface S2C_HostChanged { newHostPlayerId: string; }
export interface S2C_GameStart { mapType: 'procedural'|'bmap'; mapName: string; seed: number; teamAssignments: {playerId: string; teamIndex: number}[]; players: PlayerInfo[]; settings: RoomSettings; serverStartTime: number; }
export interface S2C_StateSnapshot extends WorldSnapshot { tankStates: TankState[]; timeElapsed: number; }
export interface S2C_TankState extends TankState {}
export interface S2C_BulletFired { shooterId: string; x: number; y: number; angleDeg: number; }
export interface S2C_BulletHit { targetId: string; damage: number; shooterId: string; }
export interface S2C_TileChanged extends TileDiff { playerId: string; }
export interface S2C_PillboxUpdate extends PillboxState {}
export interface S2C_BaseUpdate extends BaseState {}
export interface S2C_MineAdded extends MineState {}
export interface S2C_MineDetonated { tileX: number; tileY: number; damage: number; triggeredBy: string; }
export interface S2C_BoatAdded extends BoatState {}
export interface S2C_TimeUpdate { remaining: number; }
export interface S2C_PlayerKill { killerId: string; killerName: string; victimId: string; victimName: string; }
export interface S2C_GameOver { reason: 'timer'|'domination'|'deathmatch'|'lastPlayer'; winnerId: string|null; winnerName: string; scores: {playerId: string; name: string; teamIndex: number; kills: number; deaths: number; objectives: number;}[]; }
export interface C2S_PillboxBulletFired { pillIndex: number; x: number; y: number; angleDeg: number; }
export interface S2C_PillboxBulletFired { pillIndex: number; x: number; y: number; angleDeg: number; }
export interface C2S_SoldierState { x: number; y: number; active: boolean; }
export interface S2C_SoldierState { playerId: string; x: number; y: number; active: boolean; }
export interface S2C_PillboxFire { pillIndex: number; angleDeg: number; }
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
