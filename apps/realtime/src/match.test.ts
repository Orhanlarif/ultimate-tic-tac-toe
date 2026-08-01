import { describe, expect, it } from "vitest";
import { afterMove, createClock, startClock, tickClock } from "./clock.js";
import { MatchManager } from "./match.js";
import type { QueuedPlayer } from "./queue.js";
import { MatchmakingQueue } from "./queue.js";

function qp(
  partial: Partial<QueuedPlayer> &
    Pick<QueuedPlayer, "userId" | "displayName" | "socketId">,
): QueuedPlayer {
  return {
    isGuest: true,
    rating: 1500,
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

describe("MatchmakingQueue", () => {
  it("pairs casual players FIFO", () => {
    const q = new MatchmakingQueue();
    q.enqueue(qp({ userId: "a", displayName: "A", socketId: "1" }));
    q.enqueue(qp({ userId: "b", displayName: "B", socketId: "2" }));
    const pair = q.tryMatch("casual");
    expect(pair?.[0]?.userId).toBe("a");
    expect(pair?.[1]?.userId).toBe("b");
  });

  it("leaveBySocket only removes owning socket", () => {
    const q = new MatchmakingQueue();
    q.enqueue(qp({ userId: "a", displayName: "A", socketId: "s1" }));
    expect(q.leaveBySocket("a", "stale")).toBe(false);
    expect(q.size("casual")).toBe(1);
    expect(q.leaveBySocket("a", "s1")).toBe(true);
    expect(q.size("casual")).toBe(0);
  });

  it("pairs ranked within rating window", () => {
    const q = new MatchmakingQueue();
    q.enqueue(
      qp({
        userId: "a",
        displayName: "A",
        socketId: "1",
        mode: "ranked",
        isGuest: false,
        rating: 1500,
      }),
    );
    q.enqueue(
      qp({
        userId: "b",
        displayName: "B",
        socketId: "2",
        mode: "ranked",
        isGuest: false,
        rating: 1520,
      }),
    );
    const pair = q.tryMatch("ranked");
    expect(pair).not.toBeNull();
  });
});

describe("MatchManager", () => {
  it("validates turns and applies moves", () => {
    const mm = new MatchManager();
    const a = qp({ userId: "a", displayName: "A", socketId: "1" });
    const b = qp({ userId: "b", displayName: "B", socketId: "2" });
    const match = mm.create(a, b);
    mm.beginClock(match);
    const xId = match.players.X.userId;
    const oId = match.players.O.userId;

    const bad = mm.playMove(match.id, oId, 1, { board: 0, cell: 0 });
    expect(bad.ok).toBe(false);

    const ok = mm.playMove(match.id, xId, 1, { board: 4, cell: 4 });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.match.state.moveCount).toBe(1);
    expect(ok.match.state.activeBoard).toBe(4);
  });

  it("resigns and ends match", () => {
    const mm = new MatchManager();
    const match = mm.create(
      qp({ userId: "a", displayName: "A", socketId: "1" }),
      qp({ userId: "b", displayName: "B", socketId: "2" }),
    );
    const ended = mm.resign(match.id, match.players.X.userId);
    expect(ended?.state.winner).toBe("O");
    expect(ended?.endedReason).toBe("resign");
  });

  it("ignores stale socket disconnect", () => {
    const mm = new MatchManager();
    const match = mm.create(
      qp({ userId: "a", displayName: "A", socketId: "auth-a" }),
      qp({ userId: "b", displayName: "B", socketId: "auth-b" }),
    );
    const seat = match.players.X.userId === "a" ? "X" : "O";
    const affected = mm.onDisconnect("a", "stale-socket");
    expect(affected).toBeNull();
    expect(match.disconnectDeadline[seat]).toBeNull();
  });

  it("reconnect clears disconnect deadline for authoritative socket", () => {
    const mm = new MatchManager();
    const match = mm.create(
      qp({ userId: "a", displayName: "A", socketId: "1" }),
      qp({ userId: "b", displayName: "B", socketId: "2" }),
    );
    mm.onDisconnect("a", "1");
    const seat = match.players.X.userId === "a" ? "X" : "O";
    expect(match.disconnectDeadline[seat]).not.toBeNull();
    mm.onReconnect("a", "socket-new");
    expect(match.disconnectDeadline[seat]).toBeNull();
    expect(match.sockets[seat]).toBe("socket-new");
  });

  it("does not timeout before clock starts", () => {
    const mm = new MatchManager();
    const match = mm.create(
      qp({ userId: "a", displayName: "A", socketId: "1" }),
      qp({ userId: "b", displayName: "B", socketId: "2" }),
    );
    match.clock = { ...match.clock, xMs: 1, turnStartedAt: null };
    const ended = mm.sweep(Date.now() + 10_000);
    expect(ended).toHaveLength(0);
    expect(match.state.status).toBe("in_progress");
  });
});

describe("clock", () => {
  it("ticks and increments", () => {
    const c = startClock(createClock(true));
    const after = afterMove(c, "O");
    expect(after.activePlayer).toBe("O");
    expect(after.xMs).toBeGreaterThan(c.xMs - 1000);
  });

  it("detects timeout", () => {
    const c = {
      ...startClock(createClock(true)),
      xMs: 10,
      turnStartedAt: Date.now() - 50,
    };
    const { timedOut } = tickClock(c);
    expect(timedOut).toBe("X");
  });
});
