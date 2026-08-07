import { describe, expect, it } from "vitest";
import { MatchmakingQueue, type QueuedPlayer } from "./queue.js";

function qp(id: string, rating = 300): QueuedPlayer {
  return {
    userId: id,
    displayName: id,
    socketId: id,
    isGuest: false,
    rating,
    rd: 50,
    volatility: 0.06,
    league: "gold",
    placementGames: 5,
    mode: "ranked",
    joinedAt: Date.now(),
    expandMs: 0,
  };
}

describe("queue load", () => {
  it("pairs many ranked players without leftover singles when even", () => {
    const q = new MatchmakingQueue();
    for (let i = 0; i < 40; i++) {
      q.enqueue(qp(`u${i}`, 300 + (i % 5) * 10));
    }
    let pairs = 0;
    while (true) {
      const p = q.tryMatch("ranked");
      if (!p) break;
      pairs += 1;
    }
    expect(pairs).toBe(20);
    expect(q.size("ranked")).toBe(0);
  });
});
