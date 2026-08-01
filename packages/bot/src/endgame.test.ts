import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyMoves,
  createGame,
  deserializeState,
  getLegalMoves,
  serializeState,
  type Cell,
  type GameState,
  type Player,
} from "@uttt/game-engine";
import { createBudget } from "./budget";
import { getProfile } from "./difficulty";
import { betterExact, solveExact } from "./endgame";
import { EndgameTable } from "./endgameTable";
import { createRng, chooseMove, SearchState } from "./index";
import { searchBestMove } from "./search";

function emptyBoard(): Cell[] {
  return Array.from({ length: 9 }, () => null);
}

function boardWith(marks: Array<[number, Player]>): Cell[] {
  const b = emptyBoard();
  for (const [cell, player] of marks) b[cell] = player;
  return b;
}

function craft(partial: {
  boards: Cell[][];
  boardWinners: GameState["boardWinners"];
  currentPlayer: Player;
  activeBoard: number | null;
}): GameState {
  const base = createGame();
  return deserializeState(
    serializeState({
      ...base,
      boards: partial.boards,
      boardWinners: partial.boardWinners,
      currentPlayer: partial.currentPlayer,
      activeBoard: partial.activeBoard,
      status: "in_progress",
      winner: null,
      moveCount: 40,
      moves: [],
    }),
  );
}

describe("exact endgame solver", () => {
  it("solves an immediate meta win", () => {
    const boards = Array.from({ length: 9 }, () => emptyBoard());
    boards[0] = boardWith([
      [0, "X"],
      [1, "X"],
      [2, "X"],
    ]);
    boards[1] = boardWith([
      [0, "X"],
      [1, "X"],
      [2, "X"],
    ]);
    boards[2] = boardWith([
      [0, "X"],
      [1, "X"],
    ]);
    const state = craft({
      boards,
      boardWinners: ["X", "X", null, null, null, null, null, null, null],
      currentPlayer: "X",
      activeBoard: 2,
    });
    const ss = new SearchState(state);
    const budget = createBudget({ timeMs: 200, nodeBudget: 50_000 });
    // Crafted midgame boards leave many playable empties elsewhere; raise the gate.
    const result = solveExact(ss, 0, budget, { maxEmpty: 80, maxBranching: 20 });
    expect(result.status).toBe("solved");
    if (result.status === "solved") {
      expect(result.outcome).toBe(1);
      expect(result.move).toEqual({ board: 2, cell: 2 });
    }
  });

  it("returns unknown when the budget is tiny", () => {
    const built = applyMoves([
      { board: 4, cell: 4 },
      { board: 4, cell: 0 },
      { board: 0, cell: 4 },
      { board: 4, cell: 8 },
    ]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const ss = new SearchState(built.state);
    const budget = createBudget({ timeMs: 1, nodeBudget: 3 });
    const result = solveExact(ss, ss.side, budget, {
      maxEmpty: 80,
      maxBranching: 81,
    });
    expect(result.status).toBe("unknown");
  });

  it("hard still plays the forced meta win via chooseMove", () => {
    const boards = Array.from({ length: 9 }, () => emptyBoard());
    boards[0] = boardWith([
      [0, "X"],
      [1, "X"],
      [2, "X"],
    ]);
    boards[1] = boardWith([
      [0, "X"],
      [1, "X"],
      [2, "X"],
    ]);
    boards[2] = boardWith([
      [0, "X"],
      [1, "X"],
    ]);
    const state = craft({
      boards,
      boardWinners: ["X", "X", null, null, null, null, null, null, null],
      currentPlayer: "X",
      activeBoard: 2,
    });
    const move = chooseMove(state, {
      difficulty: "hard",
      seed: 1,
      useOpenings: false,
      timeMs: 100,
      maxDepth: 2,
      nodeBudget: 5_000,
    });
    expect(move).toEqual({ board: 2, cell: 2 });
  });

  it(
    "endgame table does not change proven outcomes",
    () => {
      const rng = createRng(31337);
      const table = new EndgameTable(14);
      let compared = 0;

      for (let trial = 0; trial < 15; trial++) {
        let game = createGame();
        const plies = 46 + Math.floor(rng() * 6);
        for (let i = 0; i < plies; i++) {
          if (game.status !== "in_progress") break;
          const legal = getLegalMoves(game);
          if (legal.length === 0) break;
          const next = applyMove(game, legal[Math.floor(rng() * legal.length)]!);
          if (!next.ok) break;
          game = next.state;
        }
        if (game.status !== "in_progress") continue;

        const side = new SearchState(game).side;
        const plain = solveExact(
          new SearchState(game),
          side,
          createBudget({ timeMs: 200, nodeBudget: 120_000 }),
          { maxEmpty: 80, maxBranching: 81 },
        );
        const cached = solveExact(
          new SearchState(game),
          side,
          createBudget({ timeMs: 200, nodeBudget: 120_000 }),
          { maxEmpty: 80, maxBranching: 81, table },
        );

        if (plain.status === "solved" && cached.status === "solved") {
          expect(cached.outcome).toBe(plain.outcome);
          compared += 1;
        }
      }

      expect(compared).toBeGreaterThan(0);
    },
    30_000,
  );

  it("betterExact speeds wins and delays losses", () => {
    expect(betterExact(1, 3, 1, 5, true)).toBe(true);
    expect(betterExact(1, 5, 1, 3, true)).toBe(false);
    expect(betterExact(-1, 8, -1, 4, true)).toBe(true);
    expect(betterExact(-1, 3, -1, 7, true)).toBe(false);
    expect(betterExact(-1, 3, -1, 7, false)).toBe(true);
    expect(betterExact(1, 8, 1, 3, false)).toBe(true);
  });

  it("prefers the faster forced win when both moves win", () => {
    // Board 2: X can take cell 2 for immediate meta win (boards 0+1 already X).
    // Also leave a longer path unused — solver must pick the short mate.
    const boards = Array.from({ length: 9 }, () => emptyBoard());
    boards[0] = boardWith([
      [0, "X"],
      [1, "X"],
      [2, "X"],
    ]);
    boards[1] = boardWith([
      [0, "X"],
      [1, "X"],
      [2, "X"],
    ]);
    boards[2] = boardWith([
      [0, "X"],
      [1, "X"],
    ]);
    boards[3] = boardWith([
      [0, "O"],
      [1, "O"],
      [3, "X"],
      [4, "X"],
      [5, "O"],
      [6, "X"],
      [7, "O"],
      [8, "X"],
    ]);
    boards[4] = boardWith([
      [0, "O"],
      [1, "X"],
      [2, "O"],
      [3, "X"],
      [4, "O"],
      [5, "X"],
      [6, "O"],
      [7, "X"],
      [8, "O"],
    ]);
    boards[5] = boardWith([
      [0, "X"],
      [1, "O"],
      [2, "X"],
      [3, "O"],
      [4, "X"],
      [5, "O"],
      [6, "X"],
      [7, "O"],
      [8, "X"],
    ]);
    boards[6] = boardWith([
      [0, "O"],
      [1, "X"],
      [2, "O"],
      [3, "X"],
      [4, "O"],
      [5, "X"],
      [6, "O"],
      [7, "X"],
    ]);
    boards[7] = boardWith([
      [0, "X"],
      [1, "O"],
      [2, "X"],
      [3, "O"],
      [4, "X"],
      [5, "O"],
      [6, "X"],
      [7, "O"],
    ]);
    boards[8] = boardWith([
      [0, "O"],
      [1, "X"],
      [2, "O"],
      [3, "X"],
      [4, "O"],
      [5, "X"],
      [6, "O"],
      [7, "X"],
    ]);
    const state = craft({
      boards,
      boardWinners: ["X", "X", null, "X", "O", "X", null, null, null],
      currentPlayer: "X",
      activeBoard: 2,
    });
    const ss = new SearchState(state);
    const budget = createBudget({ timeMs: 200, nodeBudget: 50_000 });
    const result = solveExact(ss, 0, budget, { maxEmpty: 80, maxBranching: 20 });
    expect(result.status).toBe("solved");
    if (result.status === "solved") {
      expect(result.outcome).toBe(1);
      expect(result.move).toEqual({ board: 2, cell: 2 });
      expect(result.distance).toBe(1);
    }
  });

  it("continues heuristic search when exact solver exhausts its share", () => {
    // Open midgame: force solver eligibility with profile overrides, keep branching high.
    const boards = Array.from({ length: 9 }, () => emptyBoard());
    boards[4] = boardWith([
      [4, "X"],
      [0, "O"],
      [8, "X"],
      [2, "O"],
    ]);
    boards[0] = boardWith([[4, "X"]]);
    boards[8] = boardWith([[4, "O"]]);
    boards[2] = boardWith([[4, "X"]]);
    const state = craft({
      boards,
      boardWinners: [null, null, null, null, null, null, null, null, null],
      currentPlayer: "X",
      activeBoard: null,
    });

    const profile = {
      ...getProfile("hard"),
      endgameEmptyAuto: 80,
      endgameEmptyTry: 80,
      endgameNodeShare: 0.85,
    };
    const result = searchBestMove(state, profile, createRng(11), {
      timeMs: 400,
      maxDepth: 3,
      nodeBudget: 2_500,
    });

    expect(getLegalMoves(state)).toContainEqual(result.move);
    expect(result.info.solver?.attempted).toBe(true);
    expect(result.info.solver?.solved).toBe(false);
    // Remaining share must still run — node count grows past the solver attempt.
    expect(result.info.nodes).toBeGreaterThan(result.info.solver!.nodes);
    expect(result.info.depth).toBeGreaterThan(0);
  });
});
