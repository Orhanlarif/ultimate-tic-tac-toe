import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_EMPTY_GRACE_MS,
  ROOM_IDLE_TIMEOUT_MS,
  type RoomSnapshot,
} from "@uttt/contracts";
import type { Player } from "@uttt/game-engine";
import { toPublicPlayer, type MatchPlayer } from "./queue.js";

export type RoomSide = "host" | "guest";

export interface RoomOccupant {
  player: MatchPlayer;
  /** Null while the member is disconnected but still holds their spot. */
  socketId: string | null;
  wantsRematch: boolean;
}

export interface Room {
  code: string;
  host: RoomOccupant;
  guest: RoomOccupant | null;
  /** Set while a game from this room is live. */
  matchId: string | null;
  /** Seat the host holds in the current game, or takes in the next one. */
  hostSeat: Player;
  score: { host: number; guest: number; draw: number };
  /**
   * Who the guest half of the scoreline belongs to. A scoreline is between two
   * people, so a different player taking the seat starts a fresh one — but the
   * same player wandering off and coming back keeps theirs.
   */
  guestSeatUserId: string | null;
  createdAt: number;
  touchedAt: number;
  /** When the room last had nobody connected, for the grace timer. */
  emptySince: number | null;
}

export type JoinResult =
  | { ok: true; room: Room; rejoined: boolean }
  | { ok: false; error: "NOT_FOUND" | "FULL" };

function occupant(player: MatchPlayer, socketId: string): RoomOccupant {
  return { player, socketId, wantsRematch: false };
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byUser = new Map<string, string>();

  private newCode(): string | null {
    for (let attempt = 0; attempt < 40; attempt++) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET.charAt(
          Math.floor(Math.random() * ROOM_CODE_ALPHABET.length),
        );
      }
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  create(player: MatchPlayer, socketId: string, now = Date.now()): Room | null {
    this.leave(player.userId);
    const code = this.newCode();
    if (!code) return null;
    const room: Room = {
      code,
      host: occupant(player, socketId),
      guest: null,
      matchId: null,
      hostSeat: Math.random() < 0.5 ? "X" : "O",
      score: { host: 0, guest: 0, draw: 0 },
      guestSeatUserId: null,
      createdAt: now,
      touchedAt: now,
      emptySince: null,
    };
    this.rooms.set(code, room);
    this.byUser.set(player.userId, code);
    return room;
  }

  /** Joining a room you are already in just rebinds your socket. */
  join(
    code: string,
    player: MatchPlayer,
    socketId: string,
    now = Date.now(),
  ): JoinResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, error: "NOT_FOUND" };

    if (this.sideOf(room, player.userId)) {
      this.onReconnect(player.userId, socketId, now);
      return { ok: true, room, rejoined: true };
    }

    if (room.guest) return { ok: false, error: "FULL" };

    this.leave(player.userId);
    if (room.guestSeatUserId && room.guestSeatUserId !== player.userId) {
      room.score = { host: 0, guest: 0, draw: 0 };
    }
    room.guest = occupant(player, socketId);
    room.guestSeatUserId = player.userId;
    this.byUser.set(player.userId, code);
    this.touch(room, now);
    return { ok: true, room, rejoined: false };
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  getByUser(userId: string): Room | undefined {
    const code = this.byUser.get(userId);
    return code ? this.rooms.get(code) : undefined;
  }

  sideOf(room: Room, userId: string): RoomSide | null {
    if (room.host.player.userId === userId) return "host";
    if (room.guest?.player.userId === userId) return "guest";
    return null;
  }

  /**
   * Explicit departure. The remaining member keeps the room and the code, so a
   * host closing their tab does not strand the guest.
   */
  leave(userId: string): { room: Room; closed: boolean } | null {
    const room = this.getByUser(userId);
    if (!room) return null;
    const side = this.sideOf(room, userId);
    if (!side) return null;

    this.byUser.delete(userId);

    if (side === "guest") {
      room.guest = null;
      room.host.wantsRematch = false;
      this.touch(room);
      return { room, closed: false };
    }

    if (!room.guest) {
      this.rooms.delete(room.code);
      return { room, closed: true };
    }

    // Promote the guest so the room survives; the scoreline follows them, and
    // the seat they vacate now belongs to the host who just walked out.
    room.host = room.guest;
    room.guest = null;
    room.host.wantsRematch = false;
    room.score = {
      host: room.score.guest,
      guest: room.score.host,
      draw: room.score.draw,
    };
    room.guestSeatUserId = userId;
    room.hostSeat = room.hostSeat === "X" ? "O" : "X";
    this.touch(room);
    return { room, closed: false };
  }

  onReconnect(userId: string, socketId: string, now = Date.now()): Room | null {
    const room = this.getByUser(userId);
    if (!room) return null;
    const side = this.sideOf(room, userId);
    if (!side) return null;
    const member = side === "host" ? room.host : room.guest!;
    member.socketId = socketId;
    member.player = { ...member.player, socketId };
    this.touch(room, now);
    return room;
  }

  /** Connection dropped without leaving: hold the spot, mark them away. */
  onDisconnect(userId: string, socketId: string, now = Date.now()): Room | null {
    const room = this.getByUser(userId);
    if (!room) return null;
    const side = this.sideOf(room, userId);
    if (!side) return null;
    const member = side === "host" ? room.host : room.guest!;
    if (member.socketId !== socketId) return null;
    member.socketId = null;
    member.wantsRematch = false;
    if (!this.anyOnline(room)) room.emptySince = now;
    return room;
  }

  setRematch(userId: string, wants: boolean): Room | null {
    const room = this.getByUser(userId);
    if (!room) return null;
    const side = this.sideOf(room, userId);
    if (!side) return null;
    (side === "host" ? room.host : room.guest!).wantsRematch = wants;
    this.touch(room);
    return room;
  }

  bothReady(room: Room): boolean {
    return (
      room.matchId === null &&
      room.guest !== null &&
      room.host.wantsRematch &&
      room.guest.wantsRematch
    );
  }

  onMatchStarted(room: Room, matchId: string): void {
    room.matchId = matchId;
    room.host.wantsRematch = false;
    if (room.guest) room.guest.wantsRematch = false;
    this.touch(room);
  }

  /** Records the scoreline, then hands the first seat to the other player. */
  onMatchEnded(room: Room, winner: Player | null): void {
    if (winner === null) {
      room.score.draw += 1;
    } else {
      const hostWon = winner === room.hostSeat;
      if (hostWon) room.score.host += 1;
      else room.score.guest += 1;
    }
    room.matchId = null;
    room.hostSeat = room.hostSeat === "X" ? "O" : "X";
    room.host.wantsRematch = false;
    if (room.guest) room.guest.wantsRematch = false;
    this.touch(room);
  }

  snapshot(room: Room, forUserId: string): RoomSnapshot {
    const side = this.sideOf(room, forUserId) ?? "host";
    return {
      code: room.code,
      host: {
        player: toPublicPlayer(room.host.player),
        online: room.host.socketId !== null,
        wantsRematch: room.host.wantsRematch,
      },
      guest: room.guest
        ? {
            player: toPublicPlayer(room.guest.player),
            online: room.guest.socketId !== null,
            wantsRematch: room.guest.wantsRematch,
          }
        : null,
      youAre: side,
      status: room.matchId ? "playing" : "waiting",
      matchId: room.matchId,
      hostSeat: room.hostSeat,
      score: { ...room.score },
    };
  }

  /** Sockets that should receive an update for this room. */
  socketsOf(room: Room): string[] {
    const ids: string[] = [];
    if (room.host.socketId) ids.push(room.host.socketId);
    if (room.guest?.socketId) ids.push(room.guest.socketId);
    return ids;
  }

  membersOf(room: Room): { userId: string; socketId: string }[] {
    const out: { userId: string; socketId: string }[] = [];
    if (room.host.socketId) {
      out.push({ userId: room.host.player.userId, socketId: room.host.socketId });
    }
    if (room.guest?.socketId) {
      out.push({
        userId: room.guest.player.userId,
        socketId: room.guest.socketId,
      });
    }
    return out;
  }

  private anyOnline(room: Room): boolean {
    return room.host.socketId !== null || room.guest?.socketId != null;
  }

  private touch(room: Room, now = Date.now()): void {
    room.touchedAt = now;
    room.emptySince = this.anyOnline(room) ? null : (room.emptySince ?? now);
  }

  /** Drops abandoned and stale rooms; returns the ones removed. */
  sweep(now = Date.now()): Room[] {
    const dropped: Room[] = [];
    for (const room of [...this.rooms.values()]) {
      if (room.matchId) continue;
      const empty =
        room.emptySince !== null && now - room.emptySince >= ROOM_EMPTY_GRACE_MS;
      const stale = now - room.touchedAt >= ROOM_IDLE_TIMEOUT_MS;
      if (!empty && !stale) continue;
      this.rooms.delete(room.code);
      this.byUser.delete(room.host.player.userId);
      if (room.guest) this.byUser.delete(room.guest.player.userId);
      dropped.push(room);
    }
    return dropped;
  }

  size(): number {
    return this.rooms.size;
  }
}
