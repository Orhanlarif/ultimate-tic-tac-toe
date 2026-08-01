import { describe, expect, it } from "vitest";
import { createGame, getLegalMoves } from "@uttt/game-engine";
import { loadArenaPositions, runArena } from "./arena";
import {
  chooseMove,
  chooseMoveDetailed,
  createRng,
  DIFFICULTY_PROFILES,
  mctsBestMove,
} from "./index";

describe("profile strength invariants", () => {
  it("keeps hard stronger than medium stronger than easy in raw budgets", () => {
    expect(DIFFICULTY_PROFILES.hard.nodeBudget).toBeGreaterThan(
      DIFFICULTY_PROFILES.medium.nodeBudget,
    );
    expect(DIFFICULTY_PROFILES.medium.nodeBudget).toBeGreaterThan(
      DIFFICULTY_PROFILES.easy.nodeBudget,
    );
    expect(DIFFICULTY_PROFILES.hard.maxDepth).toBeGreaterThan(
      DIFFICULTY_PROFILES.medium.maxDepth,
    );
    expect(DIFFICULTY_PROFILES.medium.maxDepth).toBeGreaterThan(
      DIFFICULTY_PROFILES.easy.maxDepth,
    );
    expect(DIFFICULTY_PROFILES.hard.candidateWindow).toBe(0);
    expect(DIFFICULTY_PROFILES.easy.candidateWindow).toBeGreaterThan(
      DIFFICULTY_PROFILES.medium.candidateWindow,
    );
    expect(DIFFICULTY_PROFILES.easy.softBlunderRate).toBeGreaterThan(0);
    expect(DIFFICULTY_PROFILES.hard.softBlunderRate).toBe(0);
    expect(DIFFICULTY_PROFILES.hard.openingPrincipal).toBe(true);
    expect(DIFFICULTY_PROFILES.medium.openingPrincipal).toBe(false);
  });
});

describe("difficulty selection policy", () => {
  it("hard is deterministic for the same seed", () => {
    const state = createGame();
    const a = chooseMove(state, {
      difficulty: "hard",
      seed: 99,
      maxDepth: 3,
      nodeBudget: 5_000,
      timeMs: 200,
      useOpenings: false,
    });
    const b = chooseMove(state, {
      difficulty: "hard",
      seed: 99,
      maxDepth: 3,
      nodeBudget: 5_000,
      timeMs: 200,
      useOpenings: false,
    });
    expect(a).toEqual(b);
  });

  it("easy can vary across seeds while staying legal", () => {
    const state = createGame();
    const moves = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const move = chooseMove(state, {
        difficulty: "easy",
        seed,
        useOpenings: false,
        timeMs: 80,
        maxDepth: 2,
        nodeBudget: 2_500,
      });
      expect(getLegalMoves(state)).toContainEqual(move);
      moves.add(`${move.board}:${move.cell}`);
    }
    expect(moves.size).toBeGreaterThan(1);
  });
});

describe("arena smoke ordering", () => {
  it(
    "hard vs easy tiny sample has no illegal moves and non-negative hard score",
    () => {
      const positions = loadArenaPositions().slice(0, 3);
      const result = runArena(positions, {
        candidate: "hard",
        baseline: "easy",
        budgetScale: 0.1,
        timeMs: 80,
        seed: 77,
      });
      expect(result.games).toBe(6);
      expect(result.illegal).toBe(0);
      expect(result.report.score).toBeGreaterThanOrEqual(0.5);
    },
    60_000,
  );
});

describe("mcts benchmark", () => {
  it("returns a legal opening move within a tiny budget", () => {
    const state = createGame();
    const result = mctsBestMove(state, {
      timeMs: 80,
      simulations: 400,
      seedRng: createRng(42),
    });
    expect(result.move.board).toBeGreaterThanOrEqual(0);
    expect(result.move.board).toBeLessThanOrEqual(8);
    expect(result.info.nodes).toBeGreaterThan(0);
  });

  it("does not replace production alpha-beta on opening", () => {
    const state = createGame();
    const ab = chooseMoveDetailed(state, {
      difficulty: "hard",
      seed: 9,
      useOpenings: false,
      timeMs: 120,
      maxDepth: 3,
      nodeBudget: 10_000,
    });
    const mcts = mctsBestMove(state, {
      timeMs: 120,
      simulations: 1_200,
      seedRng: createRng(9),
    });

    expect(ab.move).toEqual({ board: 4, cell: 4 });
    expect(mcts.move.board).toBeGreaterThanOrEqual(0);
    const production = chooseMove(state, {
      difficulty: "hard",
      seed: 9,
      useOpenings: false,
      timeMs: 120,
      maxDepth: 3,
      nodeBudget: 10_000,
    });
    expect(production).toEqual(ab.move);
  });
});
