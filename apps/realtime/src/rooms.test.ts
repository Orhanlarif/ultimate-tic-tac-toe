import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_EMPTY_GRACE_MS,
  ROOM_IDLE_TIMEOUT_MS,
} from "@uttt/contracts";
import { describe, expect, it } from "vitest";
import type { MatchPlayer } from "./queue.js";
import { RoomManager } from "./rooms.js";

function mp(userId: string, socketId: string): MatchPlayer {
  return {
    userId,
    displayName: userId.toUpperCase(),
    isGuest: true,
    rating: 300,
    rd: 350,
    volatility: 0.06,
    league: "bronze",
    placementGames: 0,
    socketId,
  };
}

function roomWithBoth() {
  const rooms = new RoomManager();
  const room = rooms.create(mp("host", "s-host"), "s-host")!;
  rooms.join(room.code, mp("guest", "s-guest"), "s-guest");
  return { rooms, room };
}

describe("RoomManager", () => {
  it("issues codes from the unambiguous alphabet", () => {
    const rooms = new RoomManager();
    for (let i = 0; i < 30; i++) {
      const room = rooms.create(mp(`u${i}`, `s${i}`), `s${i}`)!;
      expect(room.code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of room.code) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
      }
    }
    expect(rooms.size()).toBe(30);
  });

  it("rejects unknown codes and full rooms", () => {
    const { rooms, room } = roomWithBoth();
    expect(rooms.join("ZZZZZ", mp("c", "s-c"), "s-c")).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(rooms.join(room.code, mp("c", "s-c"), "s-c")).toEqual({
      ok: false,
      error: "FULL",
    });
  });

  it("treats a second join by a member as a rejoin that rebinds the socket", () => {
    const { rooms, room } = roomWithBoth();
    const result = rooms.join(room.code, mp("guest", "s-new"), "s-new");
    expect(result).toMatchObject({ ok: true, rejoined: true });
    expect(room.guest?.socketId).toBe("s-new");
    expect(rooms.size()).toBe(1);
  });

  it("alternates the host seat and tallies the score per side", () => {
    const { rooms, room } = roomWithBoth();
    room.hostSeat = "X";

    rooms.onMatchStarted(room, "match-1");
    expect(room.matchId).toBe("match-1");
    rooms.onMatchEnded(room, "X");
    expect(room.score).toEqual({ host: 1, guest: 0, draw: 0 });
    expect(room.hostSeat).toBe("O");
    expect(room.matchId).toBeNull();

    // Host now plays O, so an O win is still the host's.
    rooms.onMatchStarted(room, "match-2");
    rooms.onMatchEnded(room, "O");
    expect(room.score).toEqual({ host: 2, guest: 0, draw: 0 });

    rooms.onMatchStarted(room, "match-3");
    rooms.onMatchEnded(room, null);
    expect(room.score).toEqual({ host: 2, guest: 0, draw: 1 });
  });

  it("needs both sides ready before a rematch counts", () => {
    const { rooms, room } = roomWithBoth();
    rooms.setRematch("host", true);
    expect(rooms.bothReady(room)).toBe(false);
    rooms.setRematch("guest", true);
    expect(rooms.bothReady(room)).toBe(true);

    // A live game blocks it, and starting one clears both flags.
    rooms.onMatchStarted(room, "match-1");
    expect(rooms.bothReady(room)).toBe(false);
    expect(room.host.wantsRematch).toBe(false);
    expect(room.guest?.wantsRematch).toBe(false);
  });

  it("promotes the guest when the host leaves, carrying the score over", () => {
    const { rooms, room } = roomWithBoth();
    room.hostSeat = "X";
    rooms.onMatchStarted(room, "match-1");
    rooms.onMatchEnded(room, "O"); // guest wins

    expect(room.score).toEqual({ host: 0, guest: 1, draw: 0 });
    const result = rooms.leave("host");
    expect(result).toMatchObject({ closed: false });
    expect(room.host.player.userId).toBe("guest");
    expect(room.guest).toBeNull();
    expect(room.score).toEqual({ host: 1, guest: 0, draw: 0 });
    expect(rooms.getByUser("host")).toBeUndefined();
    expect(rooms.getByUser("guest")).toBe(room);
  });

  it("starts a fresh scoreline for a new opponent but keeps it for a returning one", () => {
    const { rooms, room } = roomWithBoth();
    room.hostSeat = "X";
    rooms.onMatchStarted(room, "match-1");
    rooms.onMatchEnded(room, "X");
    expect(room.score).toEqual({ host: 1, guest: 0, draw: 0 });

    rooms.leave("guest");
    rooms.join(room.code, mp("guest", "s-guest-2"), "s-guest-2");
    expect(room.score).toEqual({ host: 1, guest: 0, draw: 0 });

    rooms.leave("guest");
    rooms.join(room.code, mp("stranger", "s-str"), "s-str");
    expect(room.score).toEqual({ host: 0, guest: 0, draw: 0 });
  });

  it("closes the room when its last member leaves", () => {
    const rooms = new RoomManager();
    const room = rooms.create(mp("host", "s-host"), "s-host")!;
    expect(rooms.leave("host")).toMatchObject({ closed: true });
    expect(rooms.get(room.code)).toBeUndefined();
  });

  it("holds a disconnected member's spot until the grace period lapses", () => {
    const { rooms, room } = roomWithBoth();
    const now = Date.now();

    rooms.onDisconnect("guest", "s-guest", now);
    expect(room.guest?.socketId).toBeNull();
    expect(rooms.sweep(now + ROOM_EMPTY_GRACE_MS)).toEqual([]);

    rooms.onDisconnect("host", "s-host", now);
    expect(rooms.sweep(now + ROOM_EMPTY_GRACE_MS - 1)).toEqual([]);
    expect(rooms.sweep(now + ROOM_EMPTY_GRACE_MS)).toEqual([room]);
    expect(rooms.getByUser("host")).toBeUndefined();
    expect(rooms.getByUser("guest")).toBeUndefined();
  });

  it("ignores a disconnect from a socket that no longer owns the spot", () => {
    const { rooms, room } = roomWithBoth();
    rooms.join(room.code, mp("guest", "s-new"), "s-new");
    expect(rooms.onDisconnect("guest", "s-guest")).toBeNull();
    expect(room.guest?.socketId).toBe("s-new");
  });

  it("collects idle rooms but never one with a live game", () => {
    const { rooms, room } = roomWithBoth();
    const now = Date.now();
    room.touchedAt = now - ROOM_IDLE_TIMEOUT_MS;

    rooms.onMatchStarted(room, "match-1");
    room.touchedAt = now - ROOM_IDLE_TIMEOUT_MS;
    expect(rooms.sweep(now)).toEqual([]);

    rooms.onMatchEnded(room, "X");
    room.touchedAt = now - ROOM_IDLE_TIMEOUT_MS;
    expect(rooms.sweep(now)).toEqual([room]);
  });

  it("personalizes the snapshot per member", () => {
    const { rooms, room } = roomWithBoth();
    expect(rooms.snapshot(room, "host").youAre).toBe("host");
    expect(rooms.snapshot(room, "guest").youAre).toBe("guest");
    expect(rooms.snapshot(room, "guest").host.player.displayName).toBe("HOST");
    expect(rooms.snapshot(room, "host").guest?.online).toBe(true);
  });
});
