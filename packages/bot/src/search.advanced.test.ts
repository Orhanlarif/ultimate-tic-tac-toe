import { describe, expect, it } from "vitest";
import { applyMoves, createGame, getLegalMoves } from "@uttt/game-engine";
import { BotSearchSession } from "./session";
import { chooseMove, chooseMoveDetailed } from "./index";

describe("advanced search features", () => {
  it("PVS on/off agrees on the same opening move and score", () => {
    const state = createGame();
    const withPvs = chooseMoveDetailed(state, {
      difficulty: "hard",
      seed: 9,
      useOpenings: false,
      timeMs: 200,
      maxDepth: 3,
      nodeBudget: 12_000,
      usePvs: true,
    });
    const withoutPvs = chooseMoveDetailed(state, {
      difficulty: "hard",
      seed: 9,
      useOpenings: false,
      timeMs: 200,
      maxDepth: 3,
      nodeBudget: 12_000,
      usePvs: false,
    });
    expect(withPvs.move).toEqual(withoutPvs.move);
    expect(withPvs.info.score).toBe(withoutPvs.info.score);
    expect(withPvs.move).toEqual({ board: 4, cell: 4 });
  });

  it("session TT warms across consecutive hard searches", () => {
    const session = new BotSearchSession(16);
    const built = applyMoves([
      { board: 4, cell: 4 },
      { board: 4, cell: 0 },
      { board: 0, cell: 4 },
      { board: 4, cell: 8 },
      { board: 8, cell: 4 },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const state = built.state;

    const a = chooseMoveDetailed(state, {
      difficulty: "hard",
      seed: 3,
      useOpenings: false,
      timeMs: 120,
      maxDepth: 4,
      nodeBudget: 10_000,
      session,
      gameId: "warm-1",
      botPlayer: "X",
    });
    const b = chooseMoveDetailed(state, {
      difficulty: "hard",
      seed: 4,
      useOpenings: false,
      timeMs: 120,
      maxDepth: 4,
      nodeBudget: 10_000,
      session,
      gameId: "warm-1",
      botPlayer: "X",
    });
    expect(getLegalMoves(state)).toContainEqual(a.move);
    expect(getLegalMoves(state)).toContainEqual(b.move);
    expect(b.info.ttHits).toBeGreaterThan(0);
  });

  it("clears session TT when the game id changes", () => {
    const session = new BotSearchSession(16);
    const state = createGame();
    chooseMoveDetailed(state, {
      difficulty: "medium",
      seed: 1,
      useOpenings: false,
      timeMs: 50,
      maxDepth: 2,
      nodeBudget: 3_000,
      session,
      gameId: "g1",
      botPlayer: "X",
    });
    expect(session.gameId).toBe("g1");
    chooseMoveDetailed(state, {
      difficulty: "medium",
      seed: 2,
      useOpenings: false,
      timeMs: 50,
      maxDepth: 2,
      nodeBudget: 3_000,
      session,
      gameId: "g2",
      botPlayer: "X",
    });
    expect(session.gameId).toBe("g2");
  });

  it("hard opening book plays principal center", () => {
    const state = createGame();
    const move = chooseMove(state, {
      difficulty: "hard",
      seed: 123,
      useOpenings: true,
    });
    expect(move).toEqual({ board: 4, cell: 4 });
  });
});
