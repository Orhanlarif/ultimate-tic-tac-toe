import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyMoves,
  createGame,
  getLegalMoves,
  getLocalWinner,
  getMetaWinner,
  isLegalMove,
  type Move,
} from "./index.js";

describe("createGame", () => {
  it("starts with empty boards and X to move anywhere", () => {
    const g = createGame();
    expect(g.currentPlayer).toBe("X");
    expect(g.activeBoard).toBeNull();
    expect(g.status).toBe("in_progress");
    expect(g.moveCount).toBe(0);
    expect(getLegalMoves(g)).toHaveLength(81);
  });
});

describe("getLocalWinner", () => {
  it("detects rows, columns, diagonals and draws", () => {
    expect(
      getLocalWinner(["X", "X", "X", null, null, null, null, null, null]),
    ).toBe("X");
    expect(
      getLocalWinner(["O", null, null, "O", null, null, "O", null, null]),
    ).toBe("O");
    expect(
      getLocalWinner(["X", null, null, null, "X", null, null, null, "X"]),
    ).toBe("X");
    expect(
      getLocalWinner(["X", "O", "X", "O", "X", "O", "O", "X", "O"]),
    ).toBe("draw");
  });
});

describe("send rule", () => {
  it("forces opponent into the corresponding board", () => {
    const first = applyMove(createGame(), { board: 4, cell: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.currentPlayer).toBe("O");
    expect(first.state.activeBoard).toBe(2);
    expect(getLegalMoves(first.state).every((m) => m.board === 2)).toBe(true);
  });

  it("allows free move when sent to a completed board", () => {
    const moves: Move[] = [
      { board: 4, cell: 0 }, // O -> 0
      { board: 0, cell: 4 }, // X -> 4
      { board: 4, cell: 3 }, // O -> 3
      { board: 3, cell: 4 }, // X -> 4
      { board: 4, cell: 6 }, // X wins board 4; O -> 6
    ];
    const result = applyMoves(moves);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.boardWinners[4]).toBe("X");
    expect(result.state.activeBoard).toBe(6);

    const next = applyMove(result.state, { board: 6, cell: 4 });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    // Sent to completed board 4 → free move
    expect(next.state.activeBoard).toBeNull();
    const legal = getLegalMoves(next.state);
    expect(legal.every((m) => m.board !== 4)).toBe(true);
    expect(legal.length).toBeGreaterThan(0);
  });
});

describe("illegal moves", () => {
  it("rejects occupied cells and wrong boards", () => {
    const a = applyMove(createGame(), { board: 0, cell: 4 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(isLegalMove(a.state, { board: 0, cell: 4 })).toBe(false);
    expect(isLegalMove(a.state, { board: 1, cell: 0 })).toBe(false);
    expect(isLegalMove(a.state, { board: 4, cell: 0 })).toBe(true);
  });
});

describe("meta win and draw", () => {
  it("detects meta three-in-a-row", () => {
    expect(
      getMetaWinner(["X", "X", "X", null, null, null, null, null, null]),
    ).toBe("X");
    expect(
      getMetaWinner(["draw", "draw", "draw", "draw", "draw", "draw", "draw", "draw", "draw"]),
    ).toBe("draw");
  });
});

describe("applyMoves replay", () => {
  it("replays a short game deterministically", () => {
    const moves: Move[] = [
      { board: 4, cell: 4 },
      { board: 4, cell: 0 },
      { board: 0, cell: 4 },
      { board: 4, cell: 8 },
    ];
    const r = applyMoves(moves);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.moveCount).toBe(4);
    expect(r.state.moves).toEqual(moves);
  });
});

describe("random legal play invariants", () => {
  it("keeps moveCount monotonic and never reopens finished boards", () => {
    let state = createGame();
    let guard = 0;
    while (state.status === "in_progress" && guard < 81) {
      const legal = getLegalMoves(state);
      expect(legal.length).toBeGreaterThan(0);
      for (const m of legal) {
        expect(state.boardWinners[m.board]).toBeNull();
        expect(state.boards[m.board]![m.cell]).toBeNull();
      }
      const pick = legal[guard % legal.length]!;
      const before = state.moveCount;
      const next = applyMove(state, pick);
      expect(next.ok).toBe(true);
      if (!next.ok) break;
      expect(next.state.moveCount).toBe(before + 1);
      // Finished boards stay finished
      for (let i = 0; i < 9; i++) {
        if (state.boardWinners[i] !== null) {
          expect(next.state.boardWinners[i]).toBe(state.boardWinners[i]);
        }
      }
      state = next.state;
      guard += 1;
    }
    // After game ends, no legal moves and no further apply
    if (state.status !== "in_progress") {
      expect(getLegalMoves(state)).toHaveLength(0);
      expect(applyMove(state, { board: 0, cell: 0 }).ok).toBe(false);
      if (state.winner) {
        expect(getMetaWinner(state.boardWinners)).toBe(state.winner);
      }
    }
  });
});
