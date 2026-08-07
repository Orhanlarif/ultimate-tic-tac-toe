import { describe, expect, it } from "vitest";
import { MatchManager } from "./match.js";
import type { QueuedPlayer } from "./queue.js";

function qp(
  partial: Partial<QueuedPlayer> &
    Pick<QueuedPlayer, "userId" | "displayName" | "socketId">,
): QueuedPlayer {
  return {
    isGuest: true,
    rating: 300,
    rd: 350,
    volatility: 0.06,
    league: "bronze",
    placementGames: 0,
    mode: "casual",
    joinedAt: Date.now(),
    expandMs: 0,
    ...partial,
  };
}

describe("disconnect sweep", () => {
  it("ends match after grace period only for authoritative socket", () => {
    const mm = new MatchManager();
    const match = mm.create(
      qp({ userId: "a", displayName: "A", socketId: "sock-a" }),
      qp({ userId: "b", displayName: "B", socketId: "sock-b" }),
    );
    const now = Date.now();
    expect(mm.onDisconnect("a", "wrong")).toBeNull();
    mm.onDisconnect("a", "sock-a", now);
    const seat = match.players.X.userId === "a" ? "X" : "O";
    const ended = mm.sweep(now + 61_000);
    expect(ended.length).toBe(1);
    expect(match.endedReason).toBe("disconnect");
    expect(match.state.winner).toBe(seat === "X" ? "O" : "X");
  });
});
