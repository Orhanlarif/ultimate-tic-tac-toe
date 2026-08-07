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
  type Move,
  type Player,
} from "@uttt/game-engine";
import { chooseMove, chooseMoveDetailed, pickEmergencyMove } from "./index";
import { lineThreatCount } from "./searchState";

function play(moves: Move[]) {
  const built = applyMoves(moves);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error);
  return built.state;
}

function emptyBoard(): Cell[] {
  return Array.from({ length: 9 }, () => null);
}

function boardWith(marks: Array<[number, Player]>): Cell[] {
  const b = emptyBoard();
  for (const [cell, player] of marks) b[cell] = player;
  return b;
}

/** Build a mid-game state without replaying every send rule. */
function craft(partial: {
  boards: Cell[][];
  boardWinners: GameState["boardWinners"];
  currentPlayer: Player;
  activeBoard: number | null;
}): GameState {
  const base = createGame();
  const state: GameState = {
    ...base,
    boards: partial.boards,
    boardWinners: partial.boardWinners,
    currentPlayer: partial.currentPlayer,
    activeBoard: partial.activeBoard,
    status: "in_progress",
    winner: null,
    moveCount: 20,
    moves: [],
  };
  // Round-trip through serialize to ensure a plain clone.
  return deserializeState(serializeState(state));
}

function step(state: GameState, move: Move): GameState {
  const result = applyMove(state, move);
  expect(result.ok, `illegal move ${JSON.stringify(move)}`).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

/** True when `player` can win the meta board immediately after `move` is played. */
function allowsMetaWinFor(
  state: GameState,
  move: Move,
  player: Player,
): boolean {
  const next = step(state, move);
  if (next.status !== "in_progress") return next.winner === player;
  return getLegalMoves(next).some((reply) => {
    const after = step(next, reply);
    return after.status === "won" && after.winner === player;
  });
}

describe("lineThreatCount forks", () => {
  it("counts a real fork when two distinct winning squares exist", () => {
    // X on corners 0 and 2, and center — wait classic fork:
    // X at 0, 4 → threats at multiple? 
    // Better: X at 0 and 8 (diagonal), and X at 2 → threats differ
    // Classic: X at 0, X at 2, empty elsewhere → ones only.
    // Classic fork setup mid-build: X at 4 (center), X at 0 (corner).
    // Threats: line 0-4-8 needs 8; line 0-1-2 needs nothing complete...
    // X at 0,4,6: threats at 2? No.
    // Standard fork: X at 0, X at 4, empty board otherwise:
    //   line 0-4-8 threat square 8
    //   line 2-4-6 threat square? X only at 4 → ones
    //   line 0-1-2: X at 0 → ones
    // Need two twos: X at 0,1 and X at 3,4 → threats at 2 and 5? 
    // vals: [X,X,., X,X, ., .,.,.]
    const vals = [1, 1, 0, 1, 1, 0, 0, 0, 0];
    const result = lineThreatCount(vals, 1, 0);
    expect(result.twos).toBeGreaterThanOrEqual(2);
    expect(result.forks).toBeGreaterThanOrEqual(2);
  });

  it("does not call a single dual-line square a fork", () => {
    // Top and left both need cell 0; center occupied by opponent so no extra threats.
    // [., X, X]
    // [X, O, .]
    // [X, ., .]
    const vals = [0, 1, 1, 1, 2, 0, 1, 0, 0];
    const result = lineThreatCount(vals, 1, 0);
    expect(result.twos).toBe(2);
    expect(result.forks).toBe(0);
  });
});

describe("tactical correctness", () => {
  it("takes a forced local win on hard", () => {
    const state = play([
      { board: 4, cell: 0 },
      { board: 0, cell: 4 },
      { board: 4, cell: 3 },
      { board: 3, cell: 4 },
    ]);
    const move = chooseMove(state, {
      difficulty: "hard",
      seed: 1,
      useOpenings: false,
      timeMs: 200,
      maxDepth: 4,
    });
    expect(move).toEqual({ board: 4, cell: 6 });
  });

  it("takes an immediate meta win on every difficulty", () => {
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
    // Board 2 almost won by X on the top row; X to play cell 2.
    boards[2] = boardWith([
      [0, "X"],
      [1, "X"],
    ]);
    const winners: GameState["boardWinners"] = [
      "X",
      "X",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const state = craft({
      boards,
      boardWinners: winners,
      currentPlayer: "X",
      activeBoard: 2,
    });

    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const move = chooseMove(state, {
        difficulty,
        seed: 42,
        useOpenings: false,
        timeMs: 80,
        maxDepth: 2,
        nodeBudget: 2_000,
      });
      expect(move, difficulty).toEqual({ board: 2, cell: 2 });
    }
  });

  it("blocks an immediate opponent meta win on medium and hard", () => {
    const boards = Array.from({ length: 9 }, () => emptyBoard());
    boards[0] = boardWith([
      [0, "O"],
      [1, "O"],
      [2, "O"],
    ]);
    boards[1] = boardWith([
      [0, "O"],
      [1, "O"],
      [2, "O"],
    ]);
    // Board 2 almost won by O; X must play there and block cell 2.
    boards[2] = boardWith([
      [0, "O"],
      [1, "O"],
      [3, "X"],
      [4, "X"],
    ]);
    // Give X a pointless local option elsewhere is impossible when active=2.
    // Also put a non-blocking empty cell 5 so X has a losing alternative.
    const winners: GameState["boardWinners"] = [
      "O",
      "O",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const state = craft({
      boards,
      boardWinners: winners,
      currentPlayer: "X",
      activeBoard: 2,
    });

    // Easy is beginner-facing and may miss meta-blocks (no tactical shortcut).
    for (const difficulty of ["medium", "hard"] as const) {
      const move = chooseMove(state, {
        difficulty,
        seed: 11,
        useOpenings: false,
        timeMs: 80,
        maxDepth: 2,
        nodeBudget: 2_000,
      });
      // Denying the meta win is the requirement; taking board 2 outright and
      // occupying O's winning square both satisfy it.
      expect(allowsMetaWinFor(state, move, "O"), difficulty).toBe(false);
    }
  });

  it("does not blindly take a local win that hands a meta mate", () => {
    // X can win board 4 locally, but that would leave O able to win meta next.
    const boards = Array.from({ length: 9 }, () => emptyBoard());
    boards[0] = boardWith([
      [0, "O"],
      [1, "O"],
      [2, "O"],
    ]);
    boards[1] = boardWith([
      [0, "O"],
      [1, "O"],
      [2, "O"],
    ]);
    // Board 4: X can complete top row with cell 2, sending O to board 2.
    boards[4] = boardWith([
      [0, "X"],
      [1, "X"],
      [3, "O"],
      [5, "O"],
    ]);
    // Board 2: O already has two on top — if O is sent there they win meta.
    boards[2] = boardWith([
      [0, "O"],
      [1, "O"],
    ]);
    // Safe alternative on board 4: play cell 6 (no local win, send to open board 6).
    boards[6] = emptyBoard();

    const winners: GameState["boardWinners"] = [
      "O",
      "O",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const state = craft({
      boards,
      boardWinners: winners,
      currentPlayer: "X",
      activeBoard: 4,
    });

    const move = chooseMove(state, {
      difficulty: "hard",
      seed: 5,
      useOpenings: false,
      timeMs: 250,
      maxDepth: 4,
      nodeBudget: 20_000,
    });
    expect(move).not.toEqual({ board: 4, cell: 2 });
    expect(getLegalMoves(state)).toContainEqual(move);
  });

  it("avoids free-move sends when a local alternative exists", () => {
    const boards = Array.from({ length: 9 }, () => emptyBoard());
    // Board 0 open with several empties; board 4 already finished for O.
    boards[0] = boardWith([
      [0, "X"],
      [1, "O"],
    ]);
    boards[4] = boardWith([
      [0, "O"],
      [1, "O"],
      [2, "O"],
    ]);
    const winners: GameState["boardWinners"] = [
      null,
      null,
      null,
      null,
      "O",
      null,
      null,
      null,
      null,
    ];
    const state = craft({
      boards,
      boardWinners: winners,
      currentPlayer: "X",
      activeBoard: 0,
    });

    const move = chooseMove(state, {
      difficulty: "hard",
      seed: 11,
      useOpenings: false,
      timeMs: 250,
      maxDepth: 3,
      nodeBudget: 12_000,
    });
    expect(move.board).toBe(0);
    // Cell 4 would send to finished board 4.
    expect(move.cell).not.toBe(4);
  });

  it("prefers center on empty board without openings", () => {
    const move = chooseMove(createGame(), {
      difficulty: "hard",
      seed: 3,
      useOpenings: false,
      timeMs: 300,
      maxDepth: 3,
      nodeBudget: 20_000,
    });
    expect(move.board).toBe(4);
    expect(move.cell).toBe(4);
  });

  it("reports completed depth and node stats", () => {
    const result = chooseMoveDetailed(createGame(), {
      difficulty: "medium",
      seed: 5,
      useOpenings: false,
      timeMs: 100,
      maxDepth: 3,
      nodeBudget: 8_000,
    });
    expect(result.info.depth).toBeGreaterThanOrEqual(1);
    expect(result.info.nodes).toBeGreaterThan(0);
    expect(result.info.timeMs).toBeGreaterThanOrEqual(0);
  });

  it("emergency move stays legal and respects forced meta wins", () => {
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
    const move = pickEmergencyMove(state, 99);
    expect(move).toEqual({ board: 2, cell: 2 });
  });
});
