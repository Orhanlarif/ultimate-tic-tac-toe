import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyMoves,
  createGame,
  getLegalMoves,
  type Move,
} from "@uttt/game-engine";
import {
  chooseMove,
  chooseMoveDetailed,
  createRng,
  DIFFICULTY_PROFILES,
  getHostTimeoutMs,
  getProfile,
  pickEmergencyMove,
} from "./index";

describe("createRng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("difficulty profiles", () => {
  it("exposes a single source of truth used by the worker host", () => {
    expect(getProfile("easy")).toEqual(DIFFICULTY_PROFILES.easy);
    expect(getHostTimeoutMs("hard")).toBeGreaterThan(DIFFICULTY_PROFILES.hard.timeMs);
    expect(DIFFICULTY_PROFILES.easy.useOpenings).toBe(false);
    expect(DIFFICULTY_PROFILES.hard.candidateWindow).toBe(0);
  });

  it("emergency moves are always legal", () => {
    const state = createGame();
    const move = pickEmergencyMove(state, 123);
    expect(getLegalMoves(state)).toContainEqual(move);
  });
});

describe("chooseMove invariants", () => {
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    it(`${difficulty} always returns a legal move`, () => {
      let state = createGame();
      for (let i = 0; i < 12; i++) {
        if (state.status !== "in_progress") break;
        const move = chooseMove(state, {
          difficulty,
          seed: 1000 + i,
          maxDepth: 2,
          nodeBudget: 2000,
          timeMs: 40,
          useOpenings: false,
        });
        const legal = getLegalMoves(state);
        expect(legal).toContainEqual(move);
        const next = applyMove(state, move);
        expect(next.ok).toBe(true);
        if (next.ok) state = next.state;
      }
    });
  }
});

describe("medium tactics", () => {
  it("takes an immediate local board win when available", () => {
    const moves: Move[] = [
      { board: 4, cell: 0 },
      { board: 0, cell: 4 },
      { board: 4, cell: 3 },
      { board: 3, cell: 4 },
    ];
    const built = applyMoves(moves);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const move = chooseMove(built.state, {
      difficulty: "medium",
      seed: 7,
      useOpenings: false,
      timeMs: 80,
    });
    expect(move).toEqual({ board: 4, cell: 6 });
  });
});

describe("hard determinism", () => {
  it("repeats the same move for the same seed and budget", () => {
    const state = createGame();
    const a = chooseMove(state, {
      difficulty: "hard",
      seed: 99,
      maxDepth: 3,
      nodeBudget: 5000,
      timeMs: 200,
      useOpenings: false,
    });
    const b = chooseMove(state, {
      difficulty: "hard",
      seed: 99,
      maxDepth: 3,
      nodeBudget: 5000,
      timeMs: 200,
      useOpenings: false,
    });
    expect(a).toEqual(b);
  });

  it("keeps the same strategic preference at odd and even depths", () => {
    const state = createGame();
    for (const maxDepth of [1, 2, 3]) {
      const move = chooseMove(state, {
        difficulty: "hard",
        seed: 17,
        maxDepth,
        nodeBudget: 30_000,
        timeMs: 500,
        useOpenings: false,
      });
      expect(move.cell).toBe(4);
    }
  });

  it("keeps a legal completed move when a deeper iteration is cut short", () => {
    const state = createGame();
    const interrupted = chooseMoveDetailed(state, {
      difficulty: "hard",
      seed: 21,
      maxDepth: 6,
      nodeBudget: 120,
      timeMs: 8,
      useOpenings: false,
    });
    expect(getLegalMoves(state)).toContainEqual(interrupted.move);
    // With a tiny budget the engine should not claim a deep finished search.
    expect(interrupted.info.depth).toBeLessThanOrEqual(2);
  });
});

describe("bot vs bot completes legally", () => {
  it("plays a full game without illegal moves", () => {
    let state = createGame();
    let guard = 0;
    while (state.status === "in_progress" && guard < 90) {
      const move = chooseMove(state, {
        difficulty: state.currentPlayer === "X" ? "medium" : "easy",
        seed: 50 + guard,
        maxDepth: 2,
        nodeBudget: 1500,
        timeMs: 40,
        useOpenings: false,
      });
      expect(getLegalMoves(state)).toContainEqual(move);
      const next = applyMove(state, move);
      expect(next.ok).toBe(true);
      if (!next.ok) break;
      state = next.state;
      guard += 1;
    }
    expect(state.status !== "in_progress" || guard < 90).toBe(true);
  });
});
