import { randomBytes } from 'crypto';
import { GameRoom } from './GameRoom.js';
import type { RoomSettings, RoomSummary } from './types.js';

class LobbyManager {
  private rooms      = new Map<string, GameRoom>();
  /** code → roomId */
  private codeIndex  = new Map<string, string>();
  /** socketId → roomId */
  private socketIndex = new Map<string, string>();

  // ─── Room CRUD ──────────────────────────────────────────────────────────

  createRoom(
    roomId: string, code: string, roomName: string,
    hostPlayerId: string, socketId: string,
    name: string, color: string,
    settings: RoomSettings,
  ): GameRoom {
    const room = new GameRoom(roomId, code, roomName, hostPlayerId, socketId, name, color, settings);
    this.rooms.set(roomId, room);
    this.codeIndex.set(code, roomId);
    this.socketIndex.set(socketId, roomId);
    return room;
  }

  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  getRoomByCode(code: string): GameRoom | undefined {
    const id = this.codeIndex.get(code.toUpperCase());
    return id ? this.rooms.get(id) : undefined;
  }

  getRoomBySocketId(socketId: string): GameRoom | undefined {
    const id = this.socketIndex.get(socketId);
    return id ? this.rooms.get(id) : undefined;
  }

  getPlayerIdBySocketId(socketId: string): string | undefined {
    return this.getRoomBySocketId(socketId)?.socketToPlayer.get(socketId);
  }

  // ─── Socket tracking ────────────────────────────────────────────────────

  trackSocket(socketId: string, roomId: string): void {
    this.socketIndex.set(socketId, roomId);
  }

  untrackSocket(socketId: string): void {
    this.socketIndex.delete(socketId);
  }

  // ─── Listing ────────────────────────────────────────────────────────────

  listAllActiveRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter(r => r.state !== 'ENDED')
      .map(r => r.getSummary());
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  cleanupRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.codeIndex.delete(room.code);
    for (const [sid, rid] of this.socketIndex) {
      if (rid === roomId) this.socketIndex.delete(sid);
    }
    this.rooms.delete(roomId);
  }

  // ─── Code generation ────────────────────────────────────────────────────

  generateCode(): string {
    // No 0/O/1/I to avoid ambiguity
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do {
      code = Array.from({ length: 6 }, () => CHARS[randomBytes(1)[0] % CHARS.length]).join('');
    } while (this.codeIndex.has(code));
    return code;
  }
}

export const lobbyManager = new LobbyManager();
