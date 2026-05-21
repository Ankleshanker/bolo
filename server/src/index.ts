import { randomUUID } from 'crypto';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { lobbyManager } from './LobbyManager.js';
import type {
  C2S_CreateRoom, C2S_JoinRoom, C2S_RejoinRoom,
  C2S_UpdateSettings, C2S_KickPlayer,
  C2S_TileChanged, C2S_PillboxUpdate, C2S_BaseUpdate,
  C2S_MineAdded, C2S_MineDetonated, C2S_BoatAdded,
  C2S_BulletFired, C2S_BulletHit, C2S_PlayerKill,
  C2S_PillboxBulletFired,
  C2S_SoldierState,
  C2S_TankPush,
  C2S_PillPickupSpawned, C2S_PillPickupCollected, C2S_WallHit,
  S2C_PillPickupSpawned, S2C_PillPickupCollected,
  PillPickupState,
  TankState,
  S2C_RoomJoined, S2C_PlayerJoined, S2C_PlayerGhosted,
  S2C_PlayerReconnected, S2C_PlayerRemoved, S2C_HostChanged,
  S2C_SettingsUpdated, S2C_TileChanged, S2C_BulletFired,
  S2C_MineDetonated, S2C_SoldierState, S2C_PillboxFire,
} from './types.js';
import type { GameRoom } from './GameRoom.js';

const PORT   = parseInt(process.env.PORT   ?? '3000', 10);
const ORIGIN = process.env.CORS_ORIGIN     ?? 'https://bolo-online.com';

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: {
    origin: ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', players: io.engine.clientsCount });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Attach the onPlayerExpired callback when a room is created. */
function setupRoom(room: GameRoom): void {
  room.onPlayerExpired = (playerId: string) => {
    const socketId = room.playerToSocket.get(playerId);
    if (socketId) lobbyManager.untrackSocket(socketId);

    const newHost = room.expirePlayer(playerId);
    io.to(room.roomId).emit('playerRemoved', { playerId } satisfies S2C_PlayerRemoved);
    if (newHost) io.to(room.roomId).emit('hostChanged', { newHostPlayerId: newHost } satisfies S2C_HostChanged);
    if (room.players.size === 0) lobbyManager.cleanupRoom(room.roomId);
  };
}

/** Shared path for leaveRoom and disconnect. */
function _handleLeave(socketId: string, immediate: boolean): void {
  const room = lobbyManager.getRoomBySocketId(socketId);
  lobbyManager.untrackSocket(socketId);

  if (!room) return;

  const playerId = room.socketToPlayer.get(socketId);
  if (!playerId) return;

  if (immediate) {
    // Explicit leave — hard remove right away
    const newHost = room.expirePlayer(playerId);
    io.to(room.roomId).emit('playerRemoved', { playerId } satisfies S2C_PlayerRemoved);
    if (newHost) io.to(room.roomId).emit('hostChanged', { newHostPlayerId: newHost } satisfies S2C_HostChanged);
    if (room.players.size === 0) lobbyManager.cleanupRoom(room.roomId);
  } else {
    // Disconnect — start 60 s grace timer; onPlayerExpired already configured
    room.removePlayer(playerId);
    io.to(room.roomId).emit('playerGhosted', { playerId } satisfies S2C_PlayerGhosted);
  }
}

// ─── Socket events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected  (total: ${io.engine.clientsCount})`);

  socket.emit('welcome', { socketId: socket.id });

  // Latency probe
  socket.on('ping', (cb: () => void) => {
    if (typeof cb === 'function') cb();
  });

  // ─── Room browsing ───────────────────────────────────────────────────────

  socket.on('listRooms', () => {
    socket.emit('roomList', { rooms: lobbyManager.listAllActiveRooms() });
  });

  // ─── Create room ──────────────────────────────────────────────────────────

  socket.on('createRoom', (data: C2S_CreateRoom) => {
    try {
      const roomId   = randomUUID();
      const code     = lobbyManager.generateCode();
      const playerId = randomUUID();
      const room     = lobbyManager.createRoom(
        roomId, code, data.roomName,
        playerId, socket.id,
        data.name, data.color,
        data.settings,
      );
      setupRoom(room);
      socket.join(roomId);

      const payload: S2C_RoomJoined = {
        roomId, code, playerId,
        players:  [...room.players.values()],
        settings: room.settings,
        isHost:   true,
        state:    room.state,
      };
      socket.emit('roomJoined', payload);
      console.log(`[room] ${data.name} created "${data.roomName}" (${code})`);
    } catch (e) {
      socket.emit('error', { message: String(e) });
    }
  });

  // ─── Join room ────────────────────────────────────────────────────────────

  socket.on('joinRoom', (data: C2S_JoinRoom) => {
    try {
      const room = lobbyManager.getRoomByCode(data.code);
      if (!room)                                         { socket.emit('error', { message: 'Room not found' }); return; }
      if (room.state === 'ENDED')                        { socket.emit('error', { message: 'Game has ended' }); return; }
      if (room.players.size >= room.settings.maxPlayers) { socket.emit('error', { message: 'Room is full' });   return; }

      const playerId = randomUUID();
      const info     = room.addPlayer(socket.id, playerId, data.name, data.color);
      lobbyManager.trackSocket(socket.id, room.roomId);
      socket.join(room.roomId);

      const payload: S2C_RoomJoined = {
        roomId: room.roomId, code: room.code, playerId,
        players:  [...room.players.values()],
        settings: room.settings,
        isHost:   false,
        state:    room.state,
      };
      socket.emit('roomJoined', payload);

      // Late joiner — get game start + current world state
      if (room.state === 'PLAYING') {
        socket.emit('gameStart', {
          mapType:         room.settings.mapType,
          mapName:         room.settings.mapName,
          seed:            room.settings.seed,
          teamAssignments: [...room.players.values()].map(p => ({ playerId: p.playerId, teamIndex: p.teamIndex })),
          players:         [...room.players.values()],
          settings:        room.settings,
          serverStartTime: room.serverStartTime,
        });
        socket.emit('stateSnapshot', room.getSnapshot());
      }

      socket.to(room.roomId).emit('playerJoined', { player: info } satisfies S2C_PlayerJoined);
      console.log(`[room] ${data.name} joined "${room.roomName}" (${room.code})`);
    } catch (e) {
      socket.emit('error', { message: String(e) });
    }
  });

  // ─── Rejoin (reconnect after disconnect) ──────────────────────────────────

  socket.on('rejoinRoom', (data: C2S_RejoinRoom) => {
    try {
      const room = lobbyManager.getRoomByCode(data.code);
      if (!room) { socket.emit('error', { message: 'Room not found' }); return; }

      const info = room.reconnectPlayer(socket.id, data.playerId, data.name, data.color);
      if (!info) { socket.emit('error', { message: 'Player not found — join as new player' }); return; }

      lobbyManager.trackSocket(socket.id, room.roomId);
      socket.join(room.roomId);

      const payload: S2C_RoomJoined = {
        roomId: room.roomId, code: room.code, playerId: data.playerId,
        players:  [...room.players.values()],
        settings: room.settings,
        isHost:   room.hostPlayerId === data.playerId,
        state:    room.state,
      };
      socket.emit('roomJoined', payload);

      if (room.state === 'PLAYING') {
        socket.emit('gameStart', {
          mapType:         room.settings.mapType,
          mapName:         room.settings.mapName,
          seed:            room.settings.seed,
          teamAssignments: [...room.players.values()].map(p => ({ playerId: p.playerId, teamIndex: p.teamIndex })),
          players:         [...room.players.values()],
          settings:        room.settings,
          serverStartTime: room.serverStartTime,
        });
        socket.emit('stateSnapshot', room.getSnapshot());
      }

      socket.to(room.roomId).emit('playerReconnected', { playerId: data.playerId, player: info } satisfies S2C_PlayerReconnected);
      console.log(`[room] ${data.name} rejoined "${room.roomName}" (${room.code})`);
    } catch (e) {
      socket.emit('error', { message: String(e) });
    }
  });

  // ─── Leave / kick ─────────────────────────────────────────────────────────

  socket.on('leaveRoom', () => {
    _handleLeave(socket.id, true);
  });

  socket.on('kickPlayer', (data: C2S_KickPlayer) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room) return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (playerId !== room.hostPlayerId) return;
    if (data.playerId === room.hostPlayerId) return; // can't kick yourself

    const kickedSocket = room.playerToSocket.get(data.playerId);
    const newHost      = room.expirePlayer(data.playerId);

    io.to(room.roomId).emit('playerRemoved', { playerId: data.playerId } satisfies S2C_PlayerRemoved);
    if (newHost) io.to(room.roomId).emit('hostChanged', { newHostPlayerId: newHost } satisfies S2C_HostChanged);

    if (kickedSocket) {
      lobbyManager.untrackSocket(kickedSocket);
      io.sockets.sockets.get(kickedSocket)?.leave(room.roomId);
    }
  });

  // ─── Game lifecycle ───────────────────────────────────────────────────────

  socket.on('startGame', () => {
    const room     = lobbyManager.getRoomBySocketId(socket.id);
    if (!room) return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (playerId !== room.hostPlayerId) return;
    if (room.state !== 'LOBBY') return;
    room.startGame(io, room.roomId);
    console.log(`[room] "${room.roomName}" game started`);
  });

  socket.on('updateSettings', (data: C2S_UpdateSettings) => {
    const room     = lobbyManager.getRoomBySocketId(socket.id);
    if (!room) return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (playerId !== room.hostPlayerId) return;
    if (room.state !== 'LOBBY') return;
    room.settings = { ...room.settings, ...data.settings };
    io.to(room.roomId).emit('settingsUpdated', { settings: room.settings } satisfies S2C_SettingsUpdated);
  });

  socket.on('requestSnapshot', () => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    socket.emit('stateSnapshot', room.getSnapshot());
  });

  // ─── Soldier state relay (volatile) ──────────────────────────────────────

  socket.on('soldierState', (data: C2S_SoldierState) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    const payload: S2C_SoldierState = { ...data, playerId };
    socket.volatile.to(room.roomId).emit('soldierState', payload);
  });

  // ─── Pillbox fire relay (host-only, broadcast to room) ───────────────────

  socket.on('pillboxFire', (data: S2C_PillboxFire) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (playerId !== room.hostPlayerId) return;
    socket.to(room.roomId).emit('pillboxFire', data);
  });

  // ─── Tank state relay (volatile — drops on congestion) ───────────────────

  socket.on('tankState', (state: TankState) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    state.playerId = playerId; // prevent spoofing
    room.updateTankState(state);
    socket.volatile.to(room.roomId).emit('tankState', state);
  });

  // ─── World state events ───────────────────────────────────────────────────

  socket.on('tileChanged', (data: C2S_TileChanged) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    room.updateTileChanged(data);
    const payload: S2C_TileChanged = { ...data, playerId };
    socket.to(room.roomId).emit('tileChanged', payload);
  });

  socket.on('wallHit', (data: C2S_WallHit) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    room.updateWallHit(data.tileX, data.tileY);
    socket.to(room.roomId).emit('wallHit', data);
  });

  socket.on('pillboxUpdate', (data: C2S_PillboxUpdate) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    room.updatePillbox(data);
    socket.to(room.roomId).emit('pillboxUpdate', data);
  });

  socket.on('baseUpdate', (data: C2S_BaseUpdate) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    room.updateBase(data);
    socket.to(room.roomId).emit('baseUpdate', data);
  });

  socket.on('mineAdded', (data: C2S_MineAdded) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    const mine = { ...data, ownerPlayerId: playerId };
    room.addMine(mine);
    socket.to(room.roomId).emit('mineAdded', mine);
  });

  socket.on('mineDetonated', (data: C2S_MineDetonated) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    room.removeMine(data.tileX, data.tileY);
    const payload: S2C_MineDetonated = { tileX: data.tileX, tileY: data.tileY, damage: 3, triggeredBy: playerId };
    io.to(room.roomId).emit('mineDetonated', payload);
  });

  socket.on('boatAdded', (data: C2S_BoatAdded) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    room.addBoat(data);
    socket.to(room.roomId).emit('boatAdded', data);
  });

  socket.on('pillPickupSpawned', (data: C2S_PillPickupSpawned) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    room.addPillPickup(data);
    const payload: S2C_PillPickupSpawned = data;
    socket.to(room.roomId).emit('pillPickupSpawned', payload);
  });

  socket.on('pillPickupCollected', (data: C2S_PillPickupCollected) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    const removed = room.removePillPickup(data.id);
    if (!removed) return;
    const payload: S2C_PillPickupCollected = { id: data.id, collectorId: playerId };
    io.to(room.roomId).emit('pillPickupCollected', payload);
  });

  // ─── Combat events ────────────────────────────────────────────────────────

  socket.on('bulletFired', (data: C2S_BulletFired) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;
    const payload: S2C_BulletFired = { shooterId: playerId, ...data };
    socket.to(room.roomId).emit('bulletFired', payload);
  });

  socket.on('bulletHit', (data: C2S_BulletHit) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId || data.shooterId !== playerId) return; // prevent spoofing
    io.to(room.roomId).emit('bulletHit', data);
  });

  // ── Pillbox bullet relay (host → all other clients) ──────────────────────
  socket.on('pillboxBulletFired', (data: C2S_PillboxBulletFired) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId || playerId !== room.hostPlayerId) return; // host only
    socket.to(room.roomId).emit('pillboxBulletFired', data);
  });

  socket.on('playerKill', (data: C2S_PlayerKill) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const playerId = room.socketToPlayer.get(socket.id);
    if (!playerId) return;

    // Supports two forms:
    // 1. Shooter reports: { victimId: who_i_killed }
    // 2. Victim self-reports: { victimId: my_own_id, killerId: who_killed_me }
    const isVictimSelf = data.victimId === playerId;
    const killerId = isVictimSelf ? (data.killerId ?? playerId) : playerId;
    const victimId = data.victimId;

    const kill = room.recordKill(killerId, victimId);
    if (!kill) return;

    io.to(room.roomId).emit('playerKill', kill);

    // Check win condition after every kill (e.g. deathmatch last-player-standing)
    const over = room.checkWinCondition();
    if (over) {
      room.endGame(io, room.roomId, over);
      console.log(`[room] "${room.roomName}" game over — reason: ${over.reason}`);
    }
  });

  // ─── Tank push relay ─────────────────────────────────────────────────────

  socket.on('tankPush', (data: C2S_TankPush) => {
    const room = lobbyManager.getRoomBySocketId(socket.id);
    if (!room || room.state !== 'PLAYING') return;
    const targetSocketId = room.playerToSocket.get(data.targetId);
    if (!targetSocketId) return;
    // Cap impulse server-side to prevent spoofed grief pushes
    const MAX_IMPULSE = 400;
    const ix = Math.max(-MAX_IMPULSE, Math.min(MAX_IMPULSE, data.impulseX));
    const iy = Math.max(-MAX_IMPULSE, Math.min(MAX_IMPULSE, data.impulseY));
    io.to(targetSocketId).emit('tankPush', { impulseX: ix, impulseY: iy });
  });

  // ─── Disconnect ────────────────────────────────────────────────────────────

  socket.on('disconnect', (reason) => {
    console.log(`[-] ${socket.id} disconnected: ${reason}  (total: ${io.engine.clientsCount})`);
    _handleLeave(socket.id, false);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`Bolo server listening on :${PORT}  (CORS origin: ${ORIGIN})`);
});
